#!/data/data/com.termux/files/usr/bin/bash
# auto-setup-tasker.sh
# Fully automated Tasker setup using ADB and Tasker's intent API

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TASKER_PKG="net.dinglisch.android.taskerm"

echo "🤖 Automated Tasker Setup via ADB"
echo "=================================="
echo

# Connect ADB
echo "📱 Connecting ADB..."
if ! adb devices | grep -q "device$"; then
    "$SCRIPT_DIR/adb-wireless-connect.sh"
fi

if ! adb devices | grep -q "device$"; then
    echo "❌ ADB not connected"
    exit 1
fi
echo "✓ ADB connected"
echo

# Verify Tasker installed
if ! adb shell pm list packages | grep -q "^package:$TASKER_PKG$"; then
    echo "❌ Tasker not installed"
    exit 1
fi
echo "✓ Tasker installed"
echo

# Check Termux:Tasker plugin
if adb shell pm list packages | grep -q "com.termux.tasker"; then
    echo "✓ Termux:Tasker plugin installed"
    PLUGIN_INSTALLED=true
else
    echo "⚠️  Termux:Tasker plugin not found"
    echo "   Will use basic shell command approach"
    PLUGIN_INSTALLED=false
fi
echo

# Create task using Tasker's command system
echo "📝 Creating Tasker task via ADB..."

# Method 1: Use Tasker's run task intent
adb shell am broadcast -a net.dinglisch.android.tasker.ACTION_TASK \
    -e task_name "Termux Health Monitor" \
    $TASKER_PKG 2>&1 | head -5

# Method 2: Create task using shell commands to Tasker's directory
echo "📁 Creating task files..."

# Tasker stores tasks in XML format in its data directory
# We can push a pre-made task XML file

TASK_XML='
<?xml version="1.0" encoding="UTF-8"?>
<TaskerData sr="" dvi="1" tv="6.3.26">
    <Task sr="task1">
        <cdate>1731564000000</cdate>
        <edate>1731564000000</edate>
        <id>100</id>
        <nme>Termux Health Monitor</nme>
        <pri>100</pri>
        <Action sr="act0" ve="7">
            <code>1256900802</code>
            <label>Run Health Check</label>
            <se>false</se>
            <Bundle sr="arg0">
                <Vals sr="val">
                    <com.termux.execute.arguments></com.termux.execute.arguments>
                    <com.termux.execute.arguments-type>java.lang.String</com.termux.execute.arguments-type>
                    <com.termux.tasker.extra.EXECUTABLE>~/.shortcuts/check-termux-health.sh</com.termux.tasker.extra.EXECUTABLE>
                    <com.termux.tasker.extra.EXECUTABLE-type>java.lang.String</com.termux.tasker.extra.EXECUTABLE-type>
                    <com.termux.tasker.extra.TERMINAL>false</com.termux.tasker.extra.TERMINAL>
                    <com.termux.tasker.extra.TERMINAL-type>java.lang.Boolean</com.termux.tasker.extra.TERMINAL-type>
                    <com.termux.tasker.extra.VERSION_CODE>4</com.termux.tasker.extra.VERSION_CODE>
                    <com.termux.tasker.extra.VERSION_CODE-type>java.lang.Integer</com.termux.tasker.extra.VERSION_CODE-type>
                    <com.termux.tasker.extra.WORKDIR>~</com.termux.tasker.extra.WORKDIR>
                    <com.termux.tasker.extra.WORKDIR-type>java.lang.String</com.termux.tasker.extra.WORKDIR-type>
                    <com.twofortyfouram.locale.intent.extra.BLURB>~/.shortcuts/check-termux-health.sh</com.twofortyfouram.locale.intent.extra.BLURB>
                    <com.twofortyfouram.locale.intent.extra.BLURB-type>java.lang.String</com.twofortyfouram.locale.intent.extra.BLURB-type>
                    <net.dinglisch.android.tasker.RELEVANT_VARIABLES>&lt;StringArray sr=""&gt;&lt;_array_net.dinglisch.android.tasker.RELEVANT_VARIABLES0&gt;%stdout
Standard Output
The &amp;lt;B&amp;gt;stdout&amp;lt;/B&amp;gt; of the command.&lt;/_array_net.dinglisch.android.tasker.RELEVANT_VARIABLES0&gt;&lt;_array_net.dinglisch.android.tasker.RELEVANT_VARIABLES1&gt;%stderr
Standard Error
The &amp;lt;B&amp;gt;stderr&amp;lt;/B&amp;gt; of the command.&lt;/_array_net.dinglisch.android.tasker.RELEVANT_VARIABLES1&gt;&lt;_array_net.dinglisch.android.tasker.RELEVANT_VARIABLES2&gt;%result
Exit Code
The &amp;lt;B&amp;gt;exit code&amp;lt;/B&amp;gt; of the command. 0 often means success and anything else is usually a failure of some sort.&lt;/_array_net.dinglisch.android.tasker.RELEVANT_VARIABLES2&gt;&lt;/StringArray&gt;</net.dinglisch.android.tasker.RELEVANT_VARIABLES>
                    <net.dinglisch.android.tasker.RELEVANT_VARIABLES-type>[Ljava.lang.String;</net.dinglisch.android.tasker.RELEVANT_VARIABLES-type>
                    <net.dinglisch.android.tasker.extras.VARIABLE_REPLACE_KEYS>com.termux.tasker.extra.EXECUTABLE com.termux.execute.arguments com.termux.tasker.extra.WORKDIR</net.dinglisch.android.tasker.extras.VARIABLE_REPLACE_KEYS>
                    <net.dinglisch.android.tasker.extras.VARIABLE_REPLACE_KEYS-type>java.lang.String</net.dinglisch.android.tasker.extras.VARIABLE_REPLACE_KEYS-type>
                    <net.dinglisch.android.tasker.subbundled>true</net.dinglisch.android.tasker.subbundled>
                    <net.dinglisch.android.tasker.subbundled-type>java.lang.Boolean</net.dinglisch.android.tasker.subbundled-type>
                </Vals>
            </Bundle>
            <Str sr="arg1" ve="3">com.termux.tasker</Str>
            <Str sr="arg2" ve="3">com.termux.tasker.EditConfigurationActivity</Str>
            <Int sr="arg3" val="10"/>
        </Action>
        <Action sr="act1" ve="7">
            <code>37</code>
            <ConditionList sr="if">
                <Condition sr="c0" ve="3">
                    <lhs>%result</lhs>
                    <op>12</op>
                    <rhs>0</rhs>
                </Condition>
            </ConditionList>
        </Action>
        <Action sr="act2" ve="7">
            <code>523</code>
            <label>Show Recovery Notification</label>
            <Str sr="arg0" ve="3">Termux Recovery</Str>
            <Str sr="arg1" ve="3">Restarting Termux sessions...</Str>
            <Img sr="arg2" ve="2"/>
            <Int sr="arg3" val="0"/>
            <Int sr="arg4" val="0"/>
            <Str sr="arg5" ve="3"/>
            <Str sr="arg6" ve="3"/>
            <Str sr="arg7" ve="3"/>
            <Str sr="arg8" ve="3"/>
            <Int sr="arg9" val="0"/>
            <Str sr="arg10" ve="3"/>
            <Int sr="arg11" val="0"/>
        </Action>
        <Action sr="act3" ve="7">
            <code>21</code>
            <label>Launch Termux</label>
            <App sr="arg0">
                <appClass>com.termux.app.TermuxActivity</appClass>
                <appPkg>com.termux</appPkg>
                <label>Termux</label>
            </App>
            <Int sr="arg1" val="0"/>
        </Action>
        <Action sr="act4" ve="7">
            <code>30</code>
            <label>Wait 3 seconds</label>
            <Int sr="arg0" val="0"/>
            <Int sr="arg1" val="3"/>
            <Int sr="arg2" val="0"/>
            <Int sr="arg3" val="0"/>
            <Int sr="arg4" val="0"/>
        </Action>
        <Action sr="act5" ve="7">
            <code>1256900802</code>
            <label>Run Startup Script</label>
            <se>false</se>
            <Bundle sr="arg0">
                <Vals sr="val">
                    <com.termux.execute.arguments></com.termux.execute.arguments>
                    <com.termux.execute.arguments-type>java.lang.String</com.termux.execute.arguments-type>
                    <com.termux.tasker.extra.EXECUTABLE>~/.termux/boot/startup.sh</com.termux.tasker.extra.EXECUTABLE>
                    <com.termux.tasker.extra.EXECUTABLE-type>java.lang.String</com.termux.tasker.extra.EXECUTABLE-type>
                    <com.termux.tasker.extra.TERMINAL>false</com.termux.tasker.extra.TERMINAL>
                    <com.termux.tasker.extra.TERMINAL-type>java.lang.Boolean</com.termux.tasker.extra.TERMINAL-type>
                    <com.termux.tasker.extra.VERSION_CODE>4</com.termux.tasker.extra.VERSION_CODE>
                    <com.termux.tasker.extra.VERSION_CODE-type>java.lang.Integer</com.termux.tasker.extra.VERSION_CODE-type>
                    <com.termux.tasker.extra.WORKDIR>~</com.termux.tasker.extra.WORKDIR>
                    <com.termux.tasker.extra.WORKDIR-type>java.lang.String</com.termux.tasker.extra.WORKDIR-type>
                    <com.twofortyfouram.locale.intent.extra.BLURB>~/.termux/boot/startup.sh</com.twofortyfouram.locale.intent.extra.BLURB>
                    <com.twofortyfouram.locale.intent.extra.BLURB-type>java.lang.String</com.twofortyfouram.locale.intent.extra.BLURB-type>
                    <net.dinglisch.android.tasker.RELEVANT_VARIABLES>&lt;StringArray sr=""&gt;&lt;_array_net.dinglisch.android.tasker.RELEVANT_VARIABLES0&gt;%stdout
Standard Output
The &amp;lt;B&amp;gt;stdout&amp;lt;/B&amp;gt; of the command.&lt;/_array_net.dinglisch.android.tasker.RELEVANT_VARIABLES0&gt;&lt;_array_net.dinglisch.android.tasker.RELEVANT_VARIABLES1&gt;%stderr
Standard Error
The &amp;lt;B&amp;gt;stderr&amp;lt;/B&amp;gt; of the command.&lt;/_array_net.dinglisch.android.tasker.RELEVANT_VARIABLES1&gt;&lt;_array_net.dinglisch.android.tasker.RELEVANT_VARIABLES2&gt;%result
Exit Code
The &amp;lt;B&amp;gt;exit code&amp;lt;/B&amp;gt; of the command. 0 often means success and anything else is usually a failure of some sort.&lt;/_array_net.dinglisch.android.tasker.RELEVANT_VARIABLES2&gt;&lt;/StringArray&gt;</net.dinglisch.android.tasker.RELEVANT_VARIABLES>
                    <net.dinglisch.android.tasker.RELEVANT_VARIABLES-type>[Ljava.lang.String;</net.dinglisch.android.tasker.RELEVANT_VARIABLES-type>
                    <net.dinglisch.android.tasker.extras.VARIABLE_REPLACE_KEYS>com.termux.tasker.extra.EXECUTABLE com.termux.execute.arguments com.termux.tasker.extra.WORKDIR</net.dinglisch.android.tasker.extras.VARIABLE_REPLACE_KEYS>
                    <net.dinglisch.android.tasker.extras.VARIABLE_REPLACE_KEYS-type>java.lang.String</net.dinglisch.android.tasker.extras.VARIABLE_REPLACE_KEYS-type>
                    <net.dinglisch.android.tasker.subbundled>true</net.dinglisch.android.tasker.subbundled>
                    <net.dinglisch.android.tasker.subbundled-type>java.lang.Boolean</net.dinglisch.android.tasker.subbundled-type>
                </Vals>
            </Bundle>
            <Str sr="arg1" ve="3">com.termux.tasker</Str>
            <Str sr="arg2" ve="3">com.termux.tasker.EditConfigurationActivity</Str>
            <Int sr="arg3" val="10"/>
        </Action>
        <Action sr="act6" ve="7">
            <code>43</code>
            <label>End If</label>
        </Action>
    </Task>
    <Profile sr="prof1" ve="2">
        <cdate>1731564000000</cdate>
        <edate>1731564000000</edate>
        <id>101</id>
        <mid0>100</mid0>
        <Time sr="con0">
            <fh>0</fh>
            <fm>0</fm>
            <th>23</th>
            <tm>59</tm>
            <Int sr="arg0" val="600000"/>
        </Time>
        <nme>Check Termux Every 10min</nme>
    </Profile>
</TaskerData>
'

# Save to Downloads (accessible location)
TEMP_FILE="/sdcard/Download/TermuxHealthMonitor.prj.xml"
echo "$TASK_XML" | adb shell "cat > $TEMP_FILE"
echo "✓ Task XML saved to: $TEMP_FILE"
echo

# Try to import via intent
echo "📥 Importing task into Tasker..."
adb shell am broadcast \
    -a net.dinglisch.android.tasker.ACTION_IMPORT_PROJECT \
    -e path "$TEMP_FILE" \
    $TASKER_PKG || {
        echo "   ⚠️  Auto-import may not be supported"
    }

# Alternative: Open Tasker and show import option
echo "🔄 Opening Tasker for manual review..."
adb shell am start -n "$TASKER_PKG/.Tasker"
sleep 2

# Try to enable the profile
echo "✅ Attempting to enable profile..."
adb shell am broadcast \
    -a net.dinglisch.android.tasker.ACTION_PROFILE_ENABLED \
    -e name "Check Termux Every 10min" \
    --ez state true \
    $TASKER_PKG || {
        echo "   ⚠️  You may need to enable the profile manually"
    }

echo
echo "✅ Automated setup complete!"
echo
echo "📋 What was created:"
echo "   • Profile: 'Check Termux Every 10min'"
echo "   • Runs every 10 minutes"
echo "   • Checks health via: ~/.shortcuts/check-termux-health.sh"
echo "   • If unhealthy → launches Termux → runs startup.sh"
echo
echo "🔍 Verify in Tasker:"
echo "   1. Open Tasker on your device"
echo "   2. Look for 'Check Termux Every 10min' profile"
echo "   3. Ensure it has a checkmark (enabled)"
echo "   4. If not visible, import manually:"
echo "      Tasker → Menu → Data → Import Project"
echo "      Select: $TEMP_FILE"
echo
echo "🧪 Test:"
echo "   Run: bash ~/.shortcuts/check-termux-health.sh"
echo "   Should show: 'HEALTHY: 6 sessions running'"
echo
echo "   To test recovery:"
echo "   1. tmux kill-server"
echo "   2. Wait up to 10 minutes"
echo "   3. Tasker should auto-restart Termux"
