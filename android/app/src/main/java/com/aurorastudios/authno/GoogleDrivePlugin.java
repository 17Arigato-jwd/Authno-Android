package com.aurorastudios.authno;

import android.app.Activity;
import android.content.Intent;
import android.content.IntentSender;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.Scope;

import java.util.Arrays;

/**
 * GoogleDrivePlugin — v1.0.0
 *
 * Requests an access token for the drive.file scope using the Google Identity
 * Authorization API (com.google.android.gms:play-services-auth).
 *
 * Flow called from gdrive.js:
 *   1. GoogleDrive.requestDriveToken() → launches Identity.authorize()
 *   2. If already authorized: resolves immediately with { accessToken }
 *   3. If consent needed: shows native consent UI via PendingIntent,
 *      then resolves with { accessToken } after user approves.
 *   4. gdrive.js calls requestDriveToken() again when token is near expiry.
 *      Identity.authorize() handles silent refresh for already-consented
 *      users — no refresh token or client secret is ever needed.
 *
 * Dependency required in app/build.gradle:
 *   implementation "com.google.android.gms:play-services-auth:21.2.0"
 */
@CapacitorPlugin(name = "GoogleDrive")
public class GoogleDrivePlugin extends Plugin {

    private static final String TAG            = "GoogleDrivePlugin";
    private static final String DRIVE_SCOPE    = "https://www.googleapis.com/auth/drive.file";
    private static final int    DRIVE_REQ_CODE = 9741; // unique, won't clash with other plugins

    // Holds the PluginCall while the consent UI activity is open.
    private PluginCall savedDriveCall = null;

    @PluginMethod
    public void requestDriveToken(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Activity not available");
            return;
        }

        AuthorizationRequest authRequest = AuthorizationRequest.builder()
            .setRequestedScopes(Arrays.asList(new Scope(DRIVE_SCOPE)))
            .build();

        Identity.getAuthorizationClient(activity)
            .authorize(authRequest)
            .addOnSuccessListener(authResult -> {
                if (authResult.hasResolution()) {
                    // Consent UI required — save the call and launch it.
                    call.save();
                    savedDriveCall = call;
                    try {
                        activity.startIntentSenderForResult(
                            authResult.getPendingIntent().getIntentSender(),
                            DRIVE_REQ_CODE, null, 0, 0, 0
                        );
                    } catch (IntentSender.SendIntentException e) {
                        savedDriveCall = null;
                        Log.e(TAG, "startIntentSenderForResult failed", e);
                        call.reject("INTENT_ERROR",
                            "Could not open Drive consent screen: " + e.getMessage());
                    }
                } else {
                    // Already authorized — resolve immediately.
                    resolveTokenResult(call, authResult);
                }
            })
            .addOnFailureListener(e -> {
                Log.e(TAG, "Identity.authorize() failed: " + e.getMessage(), e);
                call.reject("DRIVE_AUTH_FAILED",
                    "Google Drive authorization failed: "
                    + e.getClass().getSimpleName() + " — " + e.getMessage());
            });
    }

    /**
     * Called by Android when the consent UI activity returns.
     * We match on DRIVE_REQ_CODE to avoid interfering with other plugins.
     */
    @Override
    protected void handleOnActivityResult(int requestCode, int resultCode, Intent data) {
        super.handleOnActivityResult(requestCode, resultCode, data);

        if (requestCode != DRIVE_REQ_CODE) return;

        PluginCall call = savedDriveCall;
        savedDriveCall = null;

        if (call == null) {
            Log.w(TAG, "handleOnActivityResult: no saved call for DRIVE_REQ_CODE");
            return;
        }

        if (resultCode != Activity.RESULT_OK) {
            call.reject("CANCELLED", "User cancelled Drive authorization");
            return;
        }

        try {
            AuthorizationResult authResult =
                Identity.getAuthorizationClient(getActivity())
                    .getAuthorizationResultFromIntent(data);
            resolveTokenResult(call, authResult);
        } catch (Exception e) {
            Log.e(TAG, "getAuthorizationResultFromIntent failed", e);
            call.reject("PARSE_ERROR",
                "Failed to read Drive authorization result: " + e.getMessage());
        }
    }

    private void resolveTokenResult(PluginCall call, AuthorizationResult authResult) {
        String accessToken = authResult.getAccessToken();
        if (accessToken == null || accessToken.isEmpty()) {
            call.reject("NO_TOKEN",
                "Drive authorization succeeded but no access token was returned. " +
                "Ensure drive.file scope is enabled in Google Cloud Console " +
                "and that this device has Google Play Services.");
            return;
        }
        JSObject ret = new JSObject();
        ret.put("accessToken", accessToken);
        call.resolve(ret);
    }
}
