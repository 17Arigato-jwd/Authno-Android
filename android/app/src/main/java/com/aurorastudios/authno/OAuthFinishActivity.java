package com.aurorastudios.authno;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

public class OAuthFinishActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 1. Capture the redirect URI (the one with the token/code)
        Uri data = getIntent().getData();

        if (data != null) {
            Intent intent = new Intent(this, MainActivity.class);
            intent.setAction(Intent.ACTION_VIEW);
            intent.setData(data);
            intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            startActivity(intent);
        }

        // 3. Close this invisible activity
        finish();
    }
}
