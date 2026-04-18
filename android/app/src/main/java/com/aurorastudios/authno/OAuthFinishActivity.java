package com.aurorastudios.authno;

import android.app.Activity;
import android.os.Bundle;

/**
 * OAuthFinishActivity — v1.2.3
 *
 * Single-use Activity whose only job is to finish itself and take the Custom Tab
 * off the back stack.
 *
 * Why this is needed:
 *   When a Custom Tab is launched via CustomTabsIntent.launchUrl(), it sits on
 *   top of the back stack as a separate task. There is no API to close it
 *   programmatically. The only reliable approach is to launch an Activity with
 *   FLAG_ACTIVITY_CLEAR_TOP that clears everything above the target, then
 *   immediately finishes. This is the documented pattern for "closing a CCT".
 *
 * Declared in AndroidManifest.xml with:
 *   android:noHistory="true"    — never kept in back stack
 *   android:theme="@android:style/Theme.NoDisplay" — invisible, no flash
 *
 * MainActivity's launchMode="singleTask" means returning to it after finish()
 * brings the existing instance back without recreating it.
 */
public class OAuthFinishActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        finish();  // Immediately finish — this pops the Custom Tab off the stack
    }
}
