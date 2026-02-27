#!/data/data/com.termux/files/usr/bin/bash
# crewind — search Claude Code session transcripts, preview context, truncate & resume
#
# Usage: crewind <search_term>
#
# Workflow:
#   1. Finds all JSONL session files containing the term (excludes subagents)
#   2. Shows matches with 100-char context before/after the term
#   3. After selecting a session, shows user messages around the match:
#      10 user messages before, the match, and 20 user messages after
#   4. Pick a truncation point → creates a new JSONL with a fresh UUID
#   5. Optionally resumes the truncated session with `claude --resume`
#
# — opus 4.6

crewind() {
  local term="$*"
  [[ -z "$term" ]] && { echo "Usage: crewind <search_term>"; return 1; }

  local RED='\033[0;31m' GREEN='\033[0;32m' YELLOW='\033[0;33m'
  local BLUE='\033[0;34m' CYAN='\033[0;36m' BOLD='\033[1m'
  local DIM='\033[2m' NC='\033[0m'

  # --- Step 1: Find matching sessions with context ---

  local files=()
  while IFS= read -r -d '' f; do
    files+=("$f")
  done < <(grep -rlZ --include='*.jsonl' "$term" "$HOME/.claude/projects" 2>/dev/null | grep -zv '/subagents/')

  [[ ${#files[@]} -eq 0 ]] && { echo "No sessions matching '$term'"; return 1; }

  echo -e "${BOLD}Sessions containing '${CYAN}${term}${NC}${BOLD}':${NC}"
  echo ""
  local i=1
  for f in "${files[@]}"; do
    local sid=$(basename "$f" .jsonl)
    local short_sid="${sid:0:8}..."

    # Get the last user message timestamp as session date
    local ts=$(jq -Rr 'fromjson? | select(.type=="user") | .timestamp // empty' "$f" 2>/dev/null | tail -1)
    local ts_short=""
    if [[ -n "$ts" ]]; then
      # Format: extract date portion
      ts_short=$(echo "$ts" | grep -oP '^\d{4}-\d{2}-\d{2}' || echo "$ts")
    fi

    # Extract context around the search term (first match in file)
    # Use grep -oP for reliable context extraction with 100 chars before/after
    local context=""
    local raw_context
    raw_context=$(grep -m1 -i "$term" "$f" 2>/dev/null \
      | grep -oiP ".{0,100}${term}.{0,100}" 2>/dev/null \
      | head -1)
    if [[ -n "$raw_context" ]]; then
      # Clean up JSON escapes and whitespace
      raw_context=$(echo "$raw_context" | sed 's/\\n/ /g; s/\\t/ /g; s/  */ /g')
      # Highlight the search term with red bold
      context=$(echo "$raw_context" | sed "s/${term}/\\\\033[1;31m&\\\\033[0m/ig")
      # Add ellipsis indicators
      [[ ${#raw_context} -ge 200 ]] && context="...${context}..."
    fi

    printf "  ${CYAN}%d)${NC} ${DIM}%s${NC}  ${YELLOW}%s${NC}\n" "$i" "$short_sid" "$ts_short"
    if [[ -n "$context" ]]; then
      printf "     %b\n" "$context"
    fi
    echo ""
    ((i++))
  done

  local choice=1
  if [[ ${#files[@]} -gt 1 ]]; then
    read -rp "Select session [1-${#files[@]}]: " choice
    [[ "$choice" =~ ^[0-9]+$ ]] || { echo "Cancelled"; return 1; }
    (( choice < 1 || choice > ${#files[@]} )) && { echo "Invalid choice"; return 1; }
  fi
  local file="${files[$((choice-1))]}"
  local dir=$(dirname "$file")
  local orig_id=$(basename "$file" .jsonl)

  # --- Step 2: Extract human-typed user messages (skip tool_results) ---

  # awk pre-filters for "type":"user" lines with line numbers, then jq parses
  # JSON properly to keep only real human messages (string content or array
  # with "text" entries but no tool_result entries).
  local term_lower="${term,,}"  # bash lowercase for matching
  local awk_output
  awk_output=$(awk '/"type":"user"/ { printf "%d\t%s\n", NR, $0 }' "$file" \
    | jq -Rr --arg term "$term_lower" '
    # Input: raw lines of "LINENUM\tJSON" — split on first tab only
    (index("\t")) as $tab |
    (.[:$tab] | tonumber) as $lnum |
    (.[($tab+1):] | fromjson? // empty) |
    select(.type == "user") |
    # Human messages: string content, or array with "text" entries (no tool_result)
    select(
      (.message.content | type) == "string" or
      ((.message.content | type) == "array"
       and (.message.content | any(.type == "text"))
       and (.message.content | any(.type == "tool_result") | not))
    ) |
    # Extract preview text
    (if (.message.content | type) == "string" then .message.content
     else [.message.content[] | select(.type == "text") | .text] | join(" ")
     end) |
    # Clean up newlines/tabs/excess whitespace, truncate
    gsub("\n"; " ") | gsub("\t"; " ") | gsub("  +"; " ") |
    (if length > 140 then .[0:140] + "..." else . end) as $text |
    # Check if term appears (case-insensitive)
    (($text | ascii_downcase) | test($term; "i")) as $has_term |
    # Output: tab-separated line (jq -r makes \t a real tab)
    "\($lnum)\t\(if $has_term then 1 else 0 end)\t\($text)"
  ' 2>/dev/null)

  [[ -z "$awk_output" ]] && { echo "No user messages in session"; return 1; }

  # Parse awk output into arrays
  local all_user_lnums=() all_user_previews=() match_indices=()
  local idx=0
  while IFS=$'\t' read -r lnum has_term preview; do
    all_user_lnums+=("$lnum")
    all_user_previews+=("$preview")
    [[ "$has_term" == "1" ]] && match_indices+=("$idx")
    ((idx++))
  done <<< "$awk_output"

  # If term not in user messages, find nearest user message to the term's location
  local anchor_idx=0
  if [[ ${#match_indices[@]} -eq 0 ]]; then
    echo -e "${YELLOW}Term found in session but not in user messages.${NC}"
    local term_line
    term_line=$(grep -n -m1 -i "$term" "$file" | cut -d: -f1)
    for idx in "${!all_user_lnums[@]}"; do
      (( all_user_lnums[idx] <= term_line )) && anchor_idx=$idx
    done
    echo "Showing user messages around line $term_line (nearest user msg at line ${all_user_lnums[$anchor_idx]})"
    match_indices=("$anchor_idx")
  fi

  # --- Step 3: Show windowed context (10 before, 20 after) around first match ---

  anchor_idx="${match_indices[0]}"

  local win_start=$((anchor_idx - 10))
  local win_end=$((anchor_idx + 20))
  (( win_start < 0 )) && win_start=0
  (( win_end >= ${#all_user_lnums[@]} )) && win_end=$(( ${#all_user_lnums[@]} - 1 ))

  echo ""
  echo -e "${BOLD}User messages (${DIM}${#all_user_lnums[@]} total, showing around match${NC}${BOLD}):${NC}"
  echo ""

  local display_lnums=()
  for (( idx=win_start; idx<=win_end; idx++ )); do
    local lnum="${all_user_lnums[$idx]}"
    local preview="${all_user_previews[$idx]}"
    display_lnums+=("$lnum")

    # Highlight if this is a match
    local marker="  "
    local color=""
    if [[ " ${match_indices[*]} " == *" $idx "* ]]; then
      marker=">>"
      color="${RED}"
    fi

    local display_num=$(( idx - win_start + 1 ))
    if [[ -n "$color" ]]; then
      printf "  ${color}${marker} ${CYAN}%2d)${NC} ${color}L%-6s %s${NC}\n" "$display_num" "$lnum" "$preview"
    else
      printf "  ${marker} ${CYAN}%2d)${NC} ${DIM}L%-6s${NC} %s\n" "$display_num" "$lnum" "$preview"
    fi
  done

  [[ ${#display_lnums[@]} -eq 0 ]] && { echo "No messages to display"; return 1; }

  # --- Step 4: Truncation selection ---

  echo ""
  echo -e "${BOLD}Truncate at which message?${NC} ${DIM}(creates new session ending at that line)${NC}"
  local mchoice
  read -rp "  [1-${#display_lnums[@]}, or 'q' to quit]: " mchoice
  [[ "$mchoice" == "q" || -z "$mchoice" ]] && { echo "Cancelled"; return 0; }
  [[ "$mchoice" =~ ^[0-9]+$ ]] || { echo "Invalid choice"; return 1; }
  (( mchoice < 1 || mchoice > ${#display_lnums[@]} )) && { echo "Out of range"; return 1; }

  local cut_line="${display_lnums[$((mchoice-1))]}"

  # --- Step 5: Create truncated copy ---

  local new_id=$(cat /proc/sys/kernel/random/uuid)
  local new_file="$dir/$new_id.jsonl"
  head -n "$cut_line" "$file" > "$new_file"

  local orig_lines=$(wc -l < "$file")
  echo ""
  echo -e "${GREEN}Created:${NC} $new_id"
  echo "  Lines: $cut_line / $orig_lines (from ${orig_id:0:8}...)"
  echo "  File:  $new_file"
  echo ""
  read -rp "Resume now? [Y/n]: " yn
  [[ "$yn" =~ ^[Nn] ]] && { echo "To resume later: claude --resume $new_id"; return 0; }
  claude --resume "$new_id"
}

# If sourced, the function is defined. If executed directly, run it.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  crewind "$@"
fi
