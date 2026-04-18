package com.aurorastudios.authno;

import android.app.Activity;
import android.util.Log;

import androidx.credentials.Credential;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.CustomCredential;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.exceptions.GetCredentialCancellationException;
import androidx.credentials.exceptions.GetCredentialException;
import androidx.credentials.exceptions.NoCredentialException;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.google.android.libraries.identity.googleid.GetGoogleIdOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;

/**
 * GoogleSignInPlugin — v1.2.4
 *
 * Fix from v1.2.3:
 *   - Create CredentialManager ONCE per signIn() call and pass it through to
 *     signInWithFilter(), instead of calling CredentialManager.create(activity)
 *     inside signInWithFilter() on every invocation.
 *
 *     Root cause of the bug: CredentialManager.create(activity) registers an
 *     ActivityResultLauncher with the Activity's ActivityResultRegistry using a
 *     fixed internal key. Pass 1 (filterAuthorized=true) creates instance A and
 *     registers that key. When Pass 1 gets NoCredentialException (no pre-authorized
 *     accounts), Pass 2 (filterAuthorized=false) created a NEW instance B and tried
 *     to register the SAME key. The conflicting registration caused the account-picker
 *     result to be lost when the user completed sign-in, which Credential Manager
 *     surfaced as GetCredentialCancellationException — i.e. "Google sign-in was
 *     cancelled" appearing right after the user tapped "Continue as Blader".
 *
 *   - Share a single Executor across both passes (minor resource fix).
 */
@CapacitorPlugin(name = "GoogleSignIn")
public class GoogleSignInPlugin extends Plugin {

    private static final String TAG = "GoogleSignInPlugin";

    @PluginMethod
    public void signIn(PluginCall call) {
        String clientId = call.getString("clientId", "");
        if (clientId == null || clientId.isEmpty()) {
            call.reject("clientId is required");
            return;
        }

        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Activity not available");
            return;
        }

        // Create ONE CredentialManager instance for this sign-in attempt and
        // reuse it across both passes. This ensures only one ActivityResultLauncher
        // is registered with the Activity's ActivityResultRegistry, preventing
        // the key-conflict that caused GetCredentialCancellationException after
        // the user completed account selection.
        CredentialManager credentialManager = CredentialManager.create(activity);
        Executor executor = Executors.newSingleThreadExecutor();

        // Pass 1: try authorized accounts first (fast path for returning users)
        signInWithFilter(call, clientId, activity, credentialManager, executor, true);
    }

    private void signInWithFilter(PluginCall call, String clientId,
                                  Activity activity, CredentialManager credentialManager,
                                  Executor executor, boolean filterAuthorized) {

        GetGoogleIdOption googleIdOption = new GetGoogleIdOption.Builder()
            .setServerClientId(clientId)
            .setFilterByAuthorizedAccounts(filterAuthorized)
            .setAutoSelectEnabled(filterAuthorized) // auto-select only on pass 1
            .setNonce(generateNonce())
            .build();

        GetCredentialRequest request = new GetCredentialRequest.Builder()
            .addCredentialOption(googleIdOption)
            .build();

        credentialManager.getCredentialAsync(
            activity,
            request,
            null,
            executor,
            new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                @Override
                public void onResult(GetCredentialResponse result) {
                    handleSuccess(call, result);
                }

                @Override
                public void onError(GetCredentialException e) {
                    Log.w(TAG, "getCredential error (filterAuthorized=" + filterAuthorized + "): "
                        + e.getClass().getSimpleName() + " — " + e.getMessage());

                    if (e instanceof NoCredentialException && filterAuthorized) {
                        // No pre-authorized accounts: fall through to full account selector.
                        // Reuse the same credentialManager instance — this is the key fix.
                        Log.d(TAG, "No authorized accounts, retrying with full selector");
                        signInWithFilter(call, clientId, activity, credentialManager, executor, false);
                    } else if (e instanceof GetCredentialCancellationException) {
                        call.reject("CANCELLED", "User cancelled the sign-in");
                    } else {
                        call.reject("SIGN_IN_ERROR", e.getMessage(), e);
                    }
                }
            }
        );
    }

    private void handleSuccess(PluginCall call, GetCredentialResponse response) {
        Credential credential = response.getCredential();

        if (credential instanceof CustomCredential) {
            CustomCredential customCred = (CustomCredential) credential;
            if (GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
                    .equals(customCred.getType())) {
                // GoogleIdTokenParsingException is unchecked in googleid 1.1.x+
                // (extends RuntimeException), so we catch RuntimeException here.
                GoogleIdTokenCredential googleIdTokenCredential;
                try {
                    googleIdTokenCredential =
                        GoogleIdTokenCredential.createFrom(customCred.getData());
                } catch (RuntimeException e) {
                    Log.e(TAG, "Invalid Google ID token response", e);
                    call.reject("TOKEN_PARSE_ERROR",
                        "Invalid Google ID token: " + e.getMessage(), e);
                    return;
                }

                JSObject ret = new JSObject();
                ret.put("idToken",      googleIdTokenCredential.getIdToken());
                ret.put("displayName",  googleIdTokenCredential.getDisplayName());
                ret.put("email",        googleIdTokenCredential.getId());
                ret.put("profilePicture",
                    googleIdTokenCredential.getProfilePictureUri() != null
                        ? googleIdTokenCredential.getProfilePictureUri().toString()
                        : null);
                call.resolve(ret);
            } else {
                call.reject("UNKNOWN_CREDENTIAL", "Unexpected credential type: " + customCred.getType());
            }
        } else {
            call.reject("UNKNOWN_CREDENTIAL", "Unexpected credential class");
        }
    }

    private String generateNonce() {
        try {
            SecureRandom random = new SecureRandom();
            byte[] bytes = new byte[32];
            random.nextBytes(bytes);
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(bytes);
            StringBuilder sb = new StringBuilder();
            for (byte b : hash) {
                sb.append(String.format("%02x", b));
            }
            return sb.toString();
        } catch (Exception e) {
            return String.valueOf(System.currentTimeMillis());
        }
    }
}