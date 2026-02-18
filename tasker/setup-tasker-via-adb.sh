#!/data/data/com.termux/files/usr/bin/bash
# setup-tasker-via-adb.sh
# Automates Tasker setup via ADB to monitor and restart Termux on crashes

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TASKER_PACKAGE="net.dinglisch.android.taskerm"
TERMUX_PACKAGE="com.termux"

echo "🤖 Tasker ADB Setup for Termux Crash Recovery"
echo "=============================================="
echo

# Ensure ADB is connected
echo "📱 Checking ADB connection..."
if ! adb devices | grep -q "device$"; then
    echo "⚠️  No device connected via ADB"
    echo "   Running wireless connection script..."
    "$REPO_DIR/tools/adb-wireless-connect.sh"
fi

# Verify connection
if ! adb devices | grep -q "device$"; then
    echo "❌ Could not connect to device"
    exit 1
fi

echo "✓ ADB connected"
echo

# Check if Tasker is installed
echo "📦 Checking if Tasker is installed..."
if ! adb shell pm list packages | grep -q "^package:$TASKER_PACKAGE$"; then
    echo "❌ Tasker not installed on device"
    echo "   Install from Play Store: https://play.google.com/store/apps/details?id=net.dinglisch.android.taskerm"
    exit 1
fi
echo "✓ Tasker installed"
echo

# Check if Termux:Tasker plugin is installed
echo "📦 Checking Termux:Tasker plugin..."
if ! adb shell pm list packages | grep -q "com.termux.tasker"; then
    echo "⚠️  Termux:Tasker plugin not installed"
    echo "   For best results, install from F-Droid:"
    echo "   https://f-droid.org/packages/com.termux.tasker/"
    echo
    echo "   Continuing with basic setup..."
else
    echo "✓ Termux:Tasker plugin installed"
fi
echo

# Check permissions
echo "🔐 Checking Tasker permissions..."
PERMISSIONS=$(adb shell dumpsys package $TASKER_PACKAGE | grep "com.termux.permission.RUN_COMMAND" || true)

if echo "$PERMISSIONS" | grep -q "granted=true"; then
    echo "✓ RUN_COMMAND permission already granted"
else
    echo "⚠️  RUN_COMMAND permission not granted"
    echo "   Attempting to grant via ADB..."
    adb shell pm grant $TASKER_PACKAGE com.termux.permission.RUN_COMMAND 2>/dev/null || {
        echo "   ⚠️  Could not auto-grant. You may need to grant manually in Termux settings."
    }
fi
echo

# Create Tasker profile XML
echo "📝 Creating Tasker profile configuration..."
PROFILE_XML=$(cat <<'PROFILE_EOF'
<TaskerData sr="" dvi="1" tv="6.3.16">
    <Profile sr="prof1" ve="2">
        <cdate>1731564000000</cdate>
        <edate>1731564000000</edate>
        <flags>8</flags>
        <id>1</id>
        <mid0>2</mid0>
        <Event sr="con0" ve="2">
            <code>2002</code>
            <pri>0</pri>
            <Str sr="arg0" ve="3">com.termux</Str>
            <Int sr="arg1" val="0"/>
            <Int sr="arg2" val="0"/>
        </Event>
        <nme>Termux Crash Monitor</nme>
    </Profile>
    <Task sr="task2">
        <cdate>1731564000000</cdate>
        <edate>1731564000000</edate>
        <id>2</id>
        <nme>Restart Termux</nme>
        <pri>100</pri>
        <Action sr="act0" ve="7">
            <code>30</code>
            <Int sr="arg0" val="0"/>
            <Int sr="arg1" val="2000"/>
            <Int sr="arg2" val="0"/>
            <Int sr="arg3" val="0"/>
            <Int sr="arg4" val="0"/>
        </Action>
        <Action sr="act1" ve="7">
            <code>21</code>
            <App sr="arg0">
                <appClass>com.termux.app.TermuxActivity</appClass>
                <appPkg>com.termux</appPkg>
                <label>Termux</label>
            </App>
            <Int sr="arg1" val="0"/>
            <Int sr="arg2" val="1"/>
            <Int sr="arg3" val="0"/>
        </Action>
        <Action sr="act2" ve="7">
            <code>548">
                <Bundle sr="arg0">
                    <Vals sr="val">
                        <com.joaomgcd.taskerm.action.IntentServiceTasker-com.twofortyfouram.locale.intent.extra.BLURB>Termux Restarted</com.joaomgcd.taskerm.action.IntentServiceTasker-com.twofortyfouram.locale.intent.extra.BLURB>
                        <com.joaomgcd.taskerm.action.IntentServiceTasker-com.twofortyfouram.locale.intent.extra.BLURB-type>java.lang.String</com.joaomgcd.taskerm.action.IntentServiceTasker-com.twofortyfouram.locale.intent.extra.BLURB-type>
                        <net.dinglisch.android.tasker.extras.VARIABLE_REPLACE_KEYS>title text plugin_type_list </net.dinglisch.android.tasker.extras.VARIABLE_REPLACE_KEYS>
                        <net.dinglisch.android.tasker.extras.VARIABLE_REPLACE_KEYS-type>java.lang.String</net.dinglisch.android.tasker.extras.VARIABLE_REPLACE_KEYS-type>
                        <title>Termux Crash Recovery</title>
                        <title-type>java.lang.String</title-type>
                        <text>Termux was restarted after crash</text>
                        <text-type>java.lang.String</text-type>
                    </Vals>
                </Bundle>
            </code>
            <Str sr="arg0" ve="3">com.joaomgcd.taskerm.action.IntentServiceTasker</Str>
            <Str sr="arg1" ve="3">com.twofortyfouram.locale.intent.action.FIRE_SETTING</Str>
            <Int sr="arg2" val="0"/>
            <Int sr="arg3" val="0"/>
            <Int sr="arg4" val="0"/>
            <App sr="arg5">
                <appClass>com.joaomgcd.taskerm.action.IntentServiceTasker</appClass>
                <appPkg>net.dinglisch.android.taskerm</appPkg>
                <label>Tasker</label>
            </App>
        </Action>
    </Task>
</TaskerData>
PROFILE_EOF
)

# Save to temp file
TEMP_XML="/sdcard/Download/TermuxCrashMonitor.prf.xml"
echo "$PROFILE_XML" | adb shell "cat > $TEMP_XML"
echo "✓ Profile XML created: $TEMP_XML"
echo

# Import into Tasker via intent
echo "📥 Importing profile into Tasker..."
adb shell am broadcast \
    -a net.dinglisch.android.tasker.ACTION_IMPORT_PROFILE \
    -e net.dinglisch.android.tasker.EXTRA_PROFILE_PATH "$TEMP_XML" \
    $TASKER_PACKAGE 2>&1 | grep -v "^$" || true

echo "✓ Import request sent to Tasker"
echo

# Alternative: Open Tasker to the profiles screen
echo "🔄 Opening Tasker..."
adb shell am start -n "$TASKER_PACKAGE/.Tasker" -a android.intent.action.MAIN

sleep 2
echo

# Enable profile via broadcast
echo "✅ Enabling profile..."
adb shell am broadcast \
    -a net.dinglisch.android.tasker.ACTION_PROFILE_ENABLED \
    -e net.dinglisch.android.tasker.EXTRA_PROFILE_NAME "Termux Crash Monitor" \
    --ez net.dinglisch.android.tasker.EXTRA_ENABLED true \
    $TASKER_PACKAGE 2>&1 | grep -v "^$" || true

echo "✓ Profile enable request sent"
echo

echo "✅ Setup Complete!"
echo
echo "📋 What was configured:"
echo "   • Profile: 'Termux Crash Monitor'"
echo "   • Event: App Closed - com.termux"
echo "   • Action 1: Wait 2 seconds"
echo "   • Action 2: Launch Termux app"
echo "   • Action 3: Show notification"
echo
echo "🧪 Testing:"
echo "   1. Open Tasker on your device"
echo "   2. Look for 'Termux Crash Monitor' profile"
echo "   3. Ensure it's enabled (checkmark)"
echo "   4. Force stop Termux to test: adb shell am force-stop com.termux"
echo
echo "📱 Manual steps (if auto-import failed):"
echo "   1. In Tasker, tap '+' → Event"
echo "   2. Select App → App Closed"
echo "   3. Choose 'Termux' from list"
echo "   4. Back, then tap '+' for task"
echo "   5. Add actions:"
echo "      - Task → Wait → 2 seconds"
echo "      - App → Launch App → Termux"
echo "      - Alert → Flash → 'Termux Restarted'"
echo
echo "💡 Tip: The profile XML is saved to:"
echo "   $TEMP_XML"
echo "   You can import it manually from Tasker: Import → Select File"
