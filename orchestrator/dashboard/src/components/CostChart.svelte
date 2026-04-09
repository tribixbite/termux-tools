<script lang="ts">
  import { fetchCostTimeline } from "../lib/api";
  import type { DailyCost } from "../lib/types";

  // -- Reactive state ----------------------------------------------------------

  let days: DailyCost[] = $state([]);
  let loading = $state(true);
  let error: string | null = $state(null);

  /** Index of the currently hovered bar (-1 = none) */
  let hoverIdx = $state(-1);

  /** Pixel position of tooltip anchor (relative to chart container) */
  let tooltipX = $state(0);
  let tooltipY = $state(0);

  /** Index of the day expanded for per-session breakdown (-1 = none) */
  let expandedIdx = $state(-1);

  /** Reference to the SVG element for coordinate mapping */
  let svgEl: SVGSVGElement | undefined = $state(undefined);

  // -- Chart geometry ----------------------------------------------------------

  const CHART_H = 140;
  const PAD_TOP = 16;
  const PAD_BOTTOM = 22;
  const PAD_LEFT = 4;
  const PAD_RIGHT = 4;
  /** Fraction of bar slot used for the bar itself (rest is gap) */
  const BAR_RATIO = 0.7;

  // -- Derived values ----------------------------------------------------------

  /** Maximum daily total across all loaded days (for Y scale) */
  const maxCost = $derived(
    days.length > 0
      ? Math.max(...days.map((d) => d.total_cost), 0.01)
      : 1,
  );

  // -- Data loading ------------------------------------------------------------

  async function load() {
    try {
      days = await fetchCostTimeline(14);
      error = null;
    } catch (e: any) {
      error = e.message ?? "Failed to load cost data";
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    if (typeof window === "undefined") return;
    load();
    // Refresh every 60s — cost data changes slowly
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  });

  // -- Helpers -----------------------------------------------------------------

  /** Format a date string as abbreviated day label ("Apr 9") */
  function fmtDate(iso: string): string {
    const d = new Date(iso);
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return `${months[d.getMonth()]} ${d.getDate()}`;
  }

  /** Format a dollar amount for display */
  function fmtCost(usd: number): string {
    if (usd < 0.005) return "$0.00";
    return `$${usd.toFixed(2)}`;
  }

  /** Compute bar geometry for a given day index within a known viewBox width */
  function barGeom(idx: number, viewW: number) {
    const usableW = viewW - PAD_LEFT - PAD_RIGHT;
    const slotW = usableW / days.length;
    const barW = Math.max(slotW * BAR_RATIO, 2);
    const x = PAD_LEFT + slotW * idx + (slotW - barW) / 2;
    const usableH = CHART_H - PAD_TOP - PAD_BOTTOM;

    const day = days[idx];
    const totalH = (day.total_cost / maxCost) * usableH;
    const inputH = (day.input_cost / maxCost) * usableH;
    const outputH = (day.output_cost / maxCost) * usableH;
    const cacheH = (day.cache_cost / maxCost) * usableH;

    // Stack bottom-up: cache, output, input
    const barBottom = CHART_H - PAD_BOTTOM;
    const cacheY = barBottom - cacheH;
    const outputY = cacheY - outputH;
    const inputY = outputY - inputH;

    return { x, barW, slotW, inputY, inputH, outputY, outputH, cacheY, cacheH, totalH, barBottom };
  }

  /** Handle pointer move over the SVG to position tooltip */
  function onPointerMove(e: PointerEvent) {
    if (!svgEl || days.length === 0) return;
    const rect = svgEl.getBoundingClientRect();
    // Map client coords into the container-relative position (for the HTML overlay)
    tooltipX = e.clientX - rect.left;
    tooltipY = e.clientY - rect.top;
  }

  /** Map client X to bar index */
  function idxFromEvent(e: PointerEvent | MouseEvent): number {
    if (!svgEl || days.length === 0) return -1;
    const rect = svgEl.getBoundingClientRect();
    const viewW = rect.width;
    const usableW = viewW - PAD_LEFT - PAD_RIGHT;
    const slotW = usableW / days.length;
    const localX = e.clientX - rect.left - PAD_LEFT;
    const idx = Math.floor(localX / slotW);
    if (idx < 0 || idx >= days.length) return -1;
    return idx;
  }
</script>

<div class="card cost-chart-card">
  <div class="card-title">
    <span class="label">Daily Cost</span>
    {#if !loading && days.length > 0}
      <span class="total-badge">
        {fmtCost(days.reduce((s, d) => s + d.total_cost, 0))}
        <span class="unit">{days.length}d</span>
      </span>
    {/if}
  </div>

  {#if loading}
    <div class="placeholder">Loading cost data...</div>
  {:else if error}
    <div class="placeholder error-msg">{error}</div>
  {:else if days.length === 0}
    <div class="placeholder">No cost data available</div>
  {:else}
    <!-- Chart container (relative for tooltip positioning) -->
    <div
      class="chart-container"
      role="img"
      aria-label="Daily API cost stacked bar chart"
    >
      <svg
        bind:this={svgEl}
        viewBox="0 0 600 {CHART_H}"
        preserveAspectRatio="none"
        width="100%"
        height="{CHART_H}px"
        onpointermove={onPointerMove}
        onpointerleave={() => (hoverIdx = -1)}
      >
        <!-- Y-axis grid lines (faint) -->
        {#each [0.25, 0.5, 0.75, 1.0] as frac}
          {@const y = CHART_H - PAD_BOTTOM - (CHART_H - PAD_TOP - PAD_BOTTOM) * frac}
          <line
            x1={PAD_LEFT}
            y1={y}
            x2={600 - PAD_RIGHT}
            y2={y}
            stroke="var(--border)"
            stroke-width="0.5"
            stroke-dasharray="3,3"
          />
        {/each}

        <!-- Bars -->
        {#each days as day, i}
          {@const g = barGeom(i, 600)}
          <!-- Invisible hit area covering the full slot height -->
          <rect
            x={PAD_LEFT + g.slotW * i}
            y={PAD_TOP}
            width={g.slotW}
            height={CHART_H - PAD_TOP - PAD_BOTTOM}
            fill="transparent"
            onpointerenter={() => (hoverIdx = i)}
            onclick={() => (expandedIdx = expandedIdx === i ? -1 : i)}
            style="cursor: pointer;"
          />
          <!-- Cache (bottom) -->
          {#if g.cacheH > 0.2}
            <rect
              x={g.x}
              y={g.cacheY}
              width={g.barW}
              height={g.cacheH}
              rx="1"
              fill="#666"
              opacity={hoverIdx === i ? 1 : 0.85}
            />
          {/if}
          <!-- Output (middle) -->
          {#if g.outputH > 0.2}
            <rect
              x={g.x}
              y={g.outputY}
              width={g.barW}
              height={g.outputH}
              rx="1"
              fill="#22c55e"
              opacity={hoverIdx === i ? 1 : 0.85}
            />
          {/if}
          <!-- Input (top) -->
          {#if g.inputH > 0.2}
            <rect
              x={g.x}
              y={g.inputY}
              width={g.barW}
              height={g.inputH}
              rx="1"
              fill="#58a6ff"
              opacity={hoverIdx === i ? 1 : 0.85}
            />
          {/if}
          <!-- Hover highlight outline -->
          {#if hoverIdx === i && g.totalH > 0.2}
            <rect
              x={g.x - 0.5}
              y={g.inputY - 0.5}
              width={g.barW + 1}
              height={g.cacheY + g.cacheH - g.inputY + 1}
              rx="1.5"
              fill="none"
              stroke="var(--text-secondary)"
              stroke-width="1"
            />
          {/if}
          <!-- X-axis date labels (every bar, or skip if too many) -->
          {#if days.length <= 14 || i % 2 === 0}
            <text
              x={g.x + g.barW / 2}
              y={CHART_H - 4}
              text-anchor="middle"
              fill="var(--text-muted)"
              font-size="9"
              font-family="inherit"
            >
              {fmtDate(day.date)}
            </text>
          {/if}
        {/each}

        <!-- Y-axis max label -->
        <text
          x={PAD_LEFT + 2}
          y={PAD_TOP - 4}
          fill="var(--text-muted)"
          font-size="8"
          font-family="inherit"
        >
          {fmtCost(maxCost)}
        </text>
      </svg>

      <!-- Hover tooltip (HTML overlay positioned via CSS) -->
      {#if hoverIdx >= 0 && hoverIdx < days.length}
        {@const day = days[hoverIdx]}
        <div
          class="tooltip"
          style="left: {tooltipX}px; top: {tooltipY}px;"
        >
          <div class="tooltip-date">{fmtDate(day.date)}</div>
          <div class="tooltip-total">{fmtCost(day.total_cost)} total</div>
          <div class="tooltip-detail">{day.turns} turn{day.turns !== 1 ? "s" : ""}</div>
          <div class="tooltip-breakdown">
            <span class="tb-input">{fmtCost(day.input_cost)} in</span>
            <span class="tb-output">{fmtCost(day.output_cost)} out</span>
            {#if day.cache_cost > 0}
              <span class="tb-cache">{fmtCost(day.cache_cost)} cache</span>
            {/if}
          </div>
        </div>
      {/if}
    </div>

    <!-- Legend -->
    <div class="legend">
      <span class="legend-item"><span class="swatch swatch-input"></span>Input</span>
      <span class="legend-item"><span class="swatch swatch-output"></span>Output</span>
      <span class="legend-item"><span class="swatch swatch-cache"></span>Cache</span>
    </div>

    <!-- Per-session breakdown table (when a bar is clicked) -->
    {#if expandedIdx >= 0 && expandedIdx < days.length}
      {@const day = days[expandedIdx]}
      <div class="breakdown">
        <div class="breakdown-header">
          <span>{fmtDate(day.date)} — {fmtCost(day.total_cost)}</span>
          <button class="close-btn" onclick={() => (expandedIdx = -1)}>x</button>
        </div>
        {#if day.sessions.length === 0}
          <p class="breakdown-empty">No per-session data</p>
        {:else}
          <table class="breakdown-table">
            <thead>
              <tr>
                <th>Session</th>
                <th class="right">Cost</th>
              </tr>
            </thead>
            <tbody>
              {#each day.sessions.sort((a, b) => b.cost - a.cost) as sess (sess.session_id)}
                <tr>
                  <td class="sess-name" title={sess.session_id}>{sess.name || sess.session_id.slice(0, 12)}</td>
                  <td class="right nums">{fmtCost(sess.cost)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  .cost-chart-card {
    padding: 0;
    overflow: hidden;
  }

  .card-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.625rem 0.75rem;
  }

  .label {
    font-size: 0.6875rem;
    font-weight: 500;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .total-badge {
    font-size: 0.625rem;
    font-weight: 600;
    padding: 0.125rem 0.375rem;
    border-radius: 3px;
    background: rgba(88, 166, 255, 0.12);
    color: var(--accent-blue);
    font-variant-numeric: tabular-nums;
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
  }

  .total-badge .unit {
    color: var(--text-muted);
    font-size: 0.5625rem;
    font-weight: 400;
  }

  .placeholder {
    padding: 2rem 0.75rem;
    text-align: center;
    font-size: 0.6875rem;
    color: var(--text-muted);
  }

  .error-msg {
    color: var(--accent-red);
  }

  /* -- Chart area ---------------------------------------------------------- */

  .chart-container {
    position: relative;
    border-top: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
    background: var(--bg-primary);
    /* Prevent touch-scroll from interfering with pointer events */
    touch-action: none;
  }

  .chart-container svg {
    display: block;
  }

  /* -- Tooltip ------------------------------------------------------------- */

  .tooltip {
    position: absolute;
    pointer-events: none;
    transform: translate(-50%, -110%);
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.375rem 0.5rem;
    font-size: 0.625rem;
    color: var(--text-primary);
    white-space: nowrap;
    z-index: 10;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  }

  .tooltip-date {
    font-weight: 600;
    margin-bottom: 2px;
    color: var(--text-secondary);
  }

  .tooltip-total {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .tooltip-detail {
    color: var(--text-muted);
    font-size: 0.5625rem;
  }

  .tooltip-breakdown {
    display: flex;
    gap: 0.375rem;
    margin-top: 2px;
    font-size: 0.5625rem;
    font-variant-numeric: tabular-nums;
  }

  .tb-input { color: #58a6ff; }
  .tb-output { color: #22c55e; }
  .tb-cache { color: #888; }

  /* -- Legend -------------------------------------------------------------- */

  .legend {
    display: flex;
    gap: 0.75rem;
    padding: 0.375rem 0.75rem;
    justify-content: center;
  }

  .legend-item {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.5625rem;
    color: var(--text-muted);
  }

  .swatch {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 2px;
  }

  .swatch-input { background: #58a6ff; }
  .swatch-output { background: #22c55e; }
  .swatch-cache { background: #666; }

  /* -- Per-session breakdown ----------------------------------------------- */

  .breakdown {
    border-top: 1px solid var(--border);
    padding: 0.5rem 0.75rem;
  }

  .breakdown-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 0.625rem;
    font-weight: 600;
    color: var(--text-secondary);
    margin-bottom: 0.375rem;
  }

  .close-btn {
    background: none;
    border: 1px solid var(--border);
    border-radius: 3px;
    color: var(--text-muted);
    font-size: 0.625rem;
    padding: 0 0.375rem;
    cursor: pointer;
    line-height: 1.4;
  }

  .close-btn:hover {
    color: var(--text-primary);
    border-color: var(--text-muted);
  }

  .breakdown-empty {
    color: var(--text-muted);
    font-size: 0.625rem;
    text-align: center;
    padding: 0.25rem 0;
  }

  .breakdown-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.625rem;
  }

  .breakdown-table th {
    text-align: left;
    font-size: 0.5625rem;
    font-weight: 500;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 0 0.25rem 0.25rem;
  }

  .breakdown-table td {
    padding: 0.1875rem 0.25rem;
    border-top: 1px solid var(--border);
  }

  .right { text-align: right; }
  .nums { font-variant-numeric: tabular-nums; }

  .sess-name {
    font-weight: 500;
    color: var(--accent-blue);
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
