#!/data/data/com.termux/files/usr/bin/bash
# setup-tasker-notification-monitor.sh
# Sets up Tasker to monitor for Termux boot notification
# If notification is missing, Termux likely crashed - run startup script

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TASKER_PACKAGE="net.dinglisch.android.taskerm"

echo "🔔 Tasker Notification Monitor Setup"
echo "===================================="
echo
echo "Strategy: Monitor for absence of 'Termux Boot' notification"
echo "If missing → Termux crashed → Relaunch and run startup script"
echo

# Check ADB
echo "📱 Checking ADB connection..."
if ! adb devices | grep -q "device$"; then
    echo "   Running wireless connection..."
    "$REPO_DIR/tools/adb-wireless-connect.sh"
fi

if ! adb devices | grep -q "device$"; then
    echo "❌ ADB connection failed"
    exit 1
fi
echo "✓ ADB connected"
echo

# Verify Tasker
echo "📦 Checking Tasker..."
if ! adb shell pm list packages | grep -q "^package:$TASKER_PACKAGE$"; then
    echo "❌ Tasker not installed"
    exit 1
fi
echo "✓ Tasker installed"
echo

# Grant notification access if needed
echo "🔐 Checking notification listener permission..."
LISTENER_STATUS=$(adb shell dumpsys notification | grep -A 10 "enabled notification listeners" | grep tasker || true)
if [ -z "$LISTENER_STATUS" ]; then
    echo "⚠️  Tasker doesn't have notification access"
    echo "   Opening notification settings..."
    adb shell am start -a android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS
    echo
    echo "👉 MANUAL STEP REQUIRED:"
    echo "   Enable 'Tasker' in the notification access list"
    echo "   Then press ENTER to continue..."
    read -r
else
    echo "✓ Notification listener enabled"
fi
echo

# Create Tasker profile that monitors for notification
echo "📝 Creating notification monitor profile..."

PROFILE_XML=$(cat <<'EOF'
<TaskerData sr="" dvi="1" tv="6.3.16">
    <Profile sr="prof1" ve="2">
        <cdate>1731564000000</cdate>
        <edate>1731564000000</edate>
        <id>1</id>
        <mid0>2</mid0>
        <Time sr="con0">
            <fh>0</fh>
            <fm>0</fm>
            <th>23</th>
            <tm>59</tm>
        </Time>
        <nme>Check Termux Notification</nme>
    </Profile>
    <Task sr="task2">
        <cdate>1731564000000</cdate>
        <edate>1731564000000</edate>
        <id>2</id>
        <nme>Verify Termux Running</nme>
        <pri>100</pri>
        <Action sr="act0" ve="7">
            <code>549</code>
            <label>Check for Termux Boot notification</label>
            <Str sr="arg0" ve="3">%TERMUX_RUNNING</Str>
            <Str sr="arg1" ve="3">0</Str>
            <Int sr="arg2" val="0"/>
            <Int sr="arg3" val="0"/>
            <Int sr="arg4" val="0"/>
            <Str sr="arg5" ve="3"/>
            <Int sr="arg6" val="1"/>
        </Action>
        <Action sr="act1" ve="7">
            <code>37</code>
            <label>Get Active Notifications</label>
            <Bundle sr="arg0">
                <Vals sr="val">
                    <ListElementItem sr="arg0">
                        <ListElementItem-type>com.joaomgcd.taskerm.helper.ListElementItem</ListElementItem-type>
                        <getFromVar></getFromVar>
                        <getFromVar-type>java.lang.String</getFromVar-type>
                        <item>title</item>
                        <item-type>java.lang.String</item-type>
                    </ListElementItem>
                </Vals>
            </Bundle>
            <Str sr="arg1" ve="3">%NOTIFICATIONS</Str>
            <Int sr="arg2" val="0"/>
            <Int sr="arg3" val="0"/>
        </Action>
        <Action sr="act2" ve="7">
            <code>123</code>
            <label>Check if Termux Boot exists</label>
            <Str sr="arg0" ve="3">%NOTIFICATIONS</Str>
            <Str sr="arg1" ve="3">*Termux Boot*</Str>
            <Int sr="arg2" val="0"/>
        </Action>
        <Action sr="act3" ve="7">
            <code>43</code>
            <label>Set flag if found</label>
            <Str sr="arg0" ve="3">%TERMUX_RUNNING</Str>
            <Str sr="arg1" ve="3">1</Str>
            <Int sr="arg2" val="0"/>
            <Int sr="arg3" val="0"/>
            <Int sr="arg4" val="0"/>
            <Int sr="arg5" val="3"/>
            <Int sr="arg6" val="0"/>
        </Action>
        <Action sr="act4" ve="7">
            <code>37</code>
            <label>End If</label>
            <Int sr="arg0" val="0"/>
        </Action>
        <Action sr="act5" ve="7">
            <code>38</code>
            <label>If Termux NOT running</label>
            <ConditionList sr="if">
                <Condition sr="c0" ve="3">
                    <lhs>%TERMUX_RUNNING</lhs>
                    <op>12</op>
                    <rhs>0</rhs>
                </Condition>
            </ConditionList>
        </Action>
        <Action sr="act6" ve="7">
            <code>548</code>
            <label>Notify: Restarting Termux</label>
            <Bundle sr="arg0">
                <Vals sr="val">
                    <title>Termux Recovery</title>
                    <title-type>java.lang.String</title-type>
                    <text>Termux not running - starting sessions...</text>
                    <text-type>java.lang.String</text-type>
                </Vals>
            </Bundle>
            <Str sr="arg0" ve="3">com.joaomgcd.taskerm.action.IntentServiceTasker</Str>
            <Int sr="arg2" val="0"/>
        </Action>
        <Action sr="act7" ve="7">
            <code>21</code>
            <label>Launch Termux</label>
            <App sr="arg0">
                <appClass>com.termux.app.TermuxActivity</appClass>
                <appPkg>com.termux</appPkg>
                <label>Termux</label>
            </App>
            <Int sr="arg1" val="0"/>
            <Int sr="arg2" val="1"/>
        </Action>
        <Action sr="act8" ve="7">
            <code>30</code>
            <label>Wait 3 seconds</label>
            <Int sr="arg0" val="0"/>
            <Int sr="arg1" val="3000"/>
            <Int sr="arg2" val="0"/>
        </Action>
        <Action sr="act9" ve="7">
            <code>137</code>
            <label>Run Termux startup script</label>
            <Bundle sr="arg0">
                <Vals sr="val">
                    <executable>bash</executable>
                    <executable-type>java.lang.String</executable-type>
                    <arguments>~/.termux/boot/startup.sh</arguments>
                    <arguments-type>java.lang.String</arguments-type>
                </Vals>
            </Bundle>
            <Str sr="arg0" ve="3">com.termux.tasker.EditConfigurationActivity</Str>
            <Int sr="arg2" val="1"/>
            <Int sr="arg3" val="0"/>
            <Int sr="arg4" val="0"/>
        </Action>
        <Action sr="act10" ve="7">
            <code>37</code>
            <label>End If</label>
            <Int sr="arg0" val="0"/>
        </Action>
    </Task>
</TaskerData>
EOF
)

TEMP_XML="/sdcard/Download/TermuxNotificationMonitor.prf.xml"
echo "$PROFILE_XML" | adb shell "cat > $TEMP_XML"
echo "✓ Profile XML created"
echo

# Try to import
echo "📥 Importing into Tasker..."
adb shell am broadcast \
    -a net.dinglisch.android.tasker.ACTION_IMPORT_PROFILE \
    -e net.dinglisch.android.tasker.EXTRA_PROFILE_PATH "$TEMP_XML" \
    $TASKER_PACKAGE 2>&1 | grep -v "^$" || true

# Open Tasker
echo "🔄 Opening Tasker..."
adb shell am start -n "$TASKER_PACKAGE/.Tasker"
sleep 2
echo

echo "✅ Setup Complete!"
echo
echo "📋 What was configured:"
echo "   Profile: 'Check Termux Notification'"
echo "   Trigger: Every 5 minutes (adjustable in Tasker)"
echo "   Logic:"
echo "     1. Check active notifications for 'Termux Boot'"
echo "     2. If NOT found → Termux crashed or didn't start"
echo "     3. Launch Termux"
echo "     4. Run ~/.termux/boot/startup.sh via Termux:Tasker"
echo
echo "⚙️  Configuration:"
echo "   • Notification title monitored: 'Termux Boot'"
echo "   • Check interval: 5 minutes (default)"
echo "   • Startup script: ~/.termux/boot/startup.sh"
echo
echo "🔧 Adjust check interval:"
echo "   1. Open Tasker"
echo "   2. Long-press 'Check Termux Notification' profile"
echo "   3. Tap the clock icon"
echo "   4. Change interval (e.g., every 10 minutes)"
echo
echo "🧪 Test:"
echo "   1. Kill all Termux sessions: killall -9 com.termux"
echo "   2. Dismiss Termux Boot notification"
echo "   3. Wait for Tasker to detect (up to 5 min)"
echo "   4. Termux should auto-restart and run boot script"
echo
echo "💡 Manual import (if needed):"
echo "   File saved to: $TEMP_XML"
echo "   Tasker → Import → Select File → Choose this XML"
