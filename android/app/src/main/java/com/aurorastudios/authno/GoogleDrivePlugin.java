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

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
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
 *   5. signOut() undoes 1-4, so the next requestDriveToken() asks again.
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
     * Disconnect, so the next requestDriveToken() asks which account again.
     *
     * ── Why this is a token revoke and not a signOut ────────────────────────
     *
     * There is no signOut on the Authorization API. Cloud Backup v1 called
     * `plugin.signOut()` and then `plugin.revoke()` inside a try/catch, with a
     * comment calling it essential for account switching. Neither method has
     * ever existed here, so the catch swallowed a TypeError every time and the
     * account never switched — invisible, because clearing the extension's own
     * stored credentials looks like it worked right up until you reconnect and
     * land on the same account.
     *
     * What actually undoes an Identity.authorize() grant is revoking the token
     * at Google's endpoint. That drops the app's authorization server-side, so
     * the next authorize() has nothing to reuse and shows consent again. It is
     * a plain HTTPS POST, which is also why it is preferable to the legacy
     * GoogleSignIn.revokeAccess(): no deprecated API, and no second sign-in
     * client whose state can disagree with this one's.
     *
     * The One Tap credential state is cleared as well. Revoking removes the
     * scope grant; the saved credential is what decides whether a picker
     * appears at all, and leaving it means the same account is chosen for you
     * before the consent screen is reached.
     *
     * Resolves rather than rejects when there is nothing to revoke. An
     * extension calls this during its own teardown, and a disconnect that
     * fails because there was already nothing connected is not a failure.
     *
     * @param accessToken optional. Without it only the credential state is
     *                    cleared, which changes the picker but not the grant.
     */
    @PluginMethod
    public void signOut(PluginCall call) {
        final Activity activity = getActivity();
        final String accessToken = call.getString("accessToken", null);

        // Off the main thread: this is a network round trip, and Android will
        // throw NetworkOnMainThreadException rather than let it block the UI.
        new Thread(() -> {
            boolean revoked = false;
            String revokeError = null;

            if (accessToken != null && !accessToken.isEmpty()) {
                try {
                    revoked = revokeToken(accessToken);
                } catch (Exception e) {
                    revokeError = e.getMessage();
                    Log.w(TAG, "token revoke failed", e);
                }
            }

            boolean cleared = false;
            if (activity != null) {
                try {
                    Identity.getSignInClient(activity).signOut();
                    cleared = true;
                } catch (Exception e) {
                    Log.w(TAG, "clearing the saved credential failed", e);
                }
            }

            JSObject ret = new JSObject();
            ret.put("revoked", revoked);
            ret.put("cleared", cleared);
            // Reported rather than thrown. The caller's own credentials are
            // already gone by the time it asks; what it needs to know is
            // whether the NEXT connect will ask which account.
            if (revokeError != null) ret.put("error", revokeError);
            call.resolve(ret);
        }).start();
    }

    /**
     * POST the token to Google's revocation endpoint.
     *
     * 200 means revoked. 400 means Google did not recognise it — already
     * revoked, or expired — which is the same outcome from the caller's side
     * and is therefore not an error worth raising.
     */
    private static boolean revokeToken(String accessToken) throws Exception {
        HttpURLConnection conn = (HttpURLConnection)
            new URL("https://oauth2.googleapis.com/revoke").openConnection();
        try {
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
            conn.setDoOutput(true);
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(10000);

            byte[] body = ("token=" + accessToken).getBytes(StandardCharsets.UTF_8);
            try (OutputStream out = conn.getOutputStream()) {
                out.write(body);
            }

            int code = conn.getResponseCode();
            if (code == 200) return true;
            if (code == 400) {
                Log.i(TAG, "revoke returned 400 — the token was already gone");
                return true;
            }
            Log.w(TAG, "revoke returned " + code);
            return false;
        } finally {
            conn.disconnect();
        }
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
