package app.notes.android;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import com.getcapacitor.JSObject;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.Scope;
import java.util.Arrays;
import android.view.View;
import android.view.Window;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** What the page (src/lib/android.ts) asks of the Android side. */
@CapacitorPlugin(name = "NotesNative")
public class NotesNativePlugin extends Plugin {

    // ── Sign in with Google (Sync) ──────────────────────────────────────────────────────────
    // Google's authorization API gives an access token for Notes' private Drive folder. Android
    // identifies the app by its package and signing key (an Android OAuth client in the Google
    // Cloud project), so there's no client secret here. Asked again whenever the token runs out:
    // without a prompt once the person has said yes.

    private static AuthorizationRequest request(PluginCall call) {
        java.util.List<Scope> scopes = new java.util.ArrayList<>();
        try {
            com.getcapacitor.JSArray asked = call.getArray("scopes");
            if (asked != null) for (int i = 0; i < asked.length(); i++) scopes.add(new Scope(asked.getString(i)));
        } catch (org.json.JSONException ignored) {
        }
        // Sync's by default: Notes' own Drive folder.
        if (scopes.isEmpty()) scopes.add(new Scope("https://www.googleapis.com/auth/drive.appdata"));
        scopes.add(new Scope("email"));
        return AuthorizationRequest.builder().setRequestedScopes(scopes).build();
    }

    private ActivityResultLauncher<IntentSenderRequest> consent;
    private PluginCall waiting;

    // ── Edge to edge ───────────────────────────────────────────────────────────────────────
    // The page fills the whole screen, behind the status and navigation bars, so its own
    // background shows there (any WebView version; Capacitor's own insets handling is off in
    // capacitor.config.ts). The bars' sizes go to the page as --safe-area-inset-* (CSS pixels) and
    // an "insets" event, and the keyboard pushes the page up from below.

    private final JSObject insets = new JSObject();

    private void edgeToEdge() {
        Window window = getActivity().getWindow();
        WindowCompat.setDecorFitsSystemWindows(window, false);
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.setNavigationBarContrastEnforced(false);
            window.setStatusBarContrastEnforced(false);
        }
        View decor = window.getDecorView();
        ViewCompat.setOnApplyWindowInsetsListener(decor, (v, all) -> {
            Insets bars = all.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            Insets ime = all.getInsets(WindowInsetsCompat.Type.ime());
            boolean keyboard = all.isVisible(WindowInsetsCompat.Type.ime());
            // The keyboard covers the navigation bar: the page ends above it.
            v.setPadding(0, 0, 0, keyboard ? ime.bottom : 0);
            float density = getActivity().getResources().getDisplayMetrics().density;
            insets.put("top", Math.round(bars.top / density));
            insets.put("bottom", keyboard ? 0 : Math.round(bars.bottom / density));
            insets.put("left", Math.round(bars.left / density));
            insets.put("right", Math.round(bars.right / density));
            // Whether the keyboard is up: when it goes away the page stops editing (no cursor left behind).
            insets.put("keyboard", keyboard);
            notifyListeners("insets", insets);
            // The bars are handled here (set to 0 for the WebView, not consumed: consuming them
            // stops the keyboard and later changes reaching it).
            return new WindowInsetsCompat.Builder(all)
                .setInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout(), Insets.NONE)
                .build();
        });
        ViewCompat.requestApplyInsets(decor);
    }

    /** The bars' sizes now (CSS pixels): { top, bottom, left, right }. */
    @PluginMethod
    public void insets(PluginCall call) {
        call.resolve(insets);
    }

    // ── A new note from outside the app ────────────────────────────────────────────────────
    // The Quick Settings tile and the app icon's shortcut open Notes with NEW_NOTE: the page
    // hears "newNote" (kept until it listens, for when Notes is only just starting).

    private void checkNewNote(Intent intent) {
        if (intent == null || !MainActivity.NEW_NOTE.equals(intent.getAction())) return;
        intent.setAction(Intent.ACTION_MAIN);
        notifyListeners("newNote", new JSObject(), true);
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        checkNewNote(intent);
    }

    // ── The S Pen ──────────────────────────────────────────────────────────────────────────
    // Samsung phones and tablets with a built-in S Pen broadcast com.samsung.pen.INSERT when it's
    // taken out or put back (penInsert false / true). The page hears "pen" ({ inserted }) and, if a
    // note is open, opens the canvas. The first (sticky) broadcast is only the current state, so
    // it's skipped. Other phones never send it.

    private BroadcastReceiver pen;

    private void listenForPen() {
        pen = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (isInitialStickyBroadcast()) return;
                JSObject ev = new JSObject();
                ev.put("inserted", intent.getBooleanExtra("penInsert", true));
                notifyListeners("pen", ev);
            }
        };
        IntentFilter filter = new IntentFilter("com.samsung.pen.INSERT");
        if (Build.VERSION.SDK_INT >= 33) getContext().registerReceiver(pen, filter, Context.RECEIVER_EXPORTED);
        else getContext().registerReceiver(pen, filter);
    }

    @Override
    protected void handleOnDestroy() {
        if (pen != null) {
            try {
                getContext().unregisterReceiver(pen);
            } catch (IllegalArgumentException ignored) {
            }
            pen = null;
        }
        super.handleOnDestroy();
    }

    @Override
    public void load() {
        listenForPen();
        checkNewNote(getActivity().getIntent());
        edgeToEdge();
        consent = getActivity().registerForActivityResult(new ActivityResultContracts.StartIntentSenderForResult(), (result) -> {
            PluginCall call = waiting;
            waiting = null;
            if (call == null) return;
            if (result.getResultCode() != Activity.RESULT_OK) {
                call.reject("Sign-in was cancelled.", "cancelled");
                return;
            }
            try {
                AuthorizationResult r = Identity.getAuthorizationClient(getActivity()).getAuthorizationResultFromIntent(result.getData());
                resolveToken(call, r);
            } catch (ApiException e) {
                call.reject("Google sign-in failed (" + e.getStatusCode() + ").", "failed");
            }
        });
    }

    private void resolveToken(PluginCall call, AuthorizationResult r) {
        if (r.getAccessToken() == null) {
            call.reject("Google didn't give Notes access.", "failed");
            return;
        }
        JSObject out = new JSObject();
        out.put("accessToken", r.getAccessToken());
        call.resolve(out);
    }

    /** interactive: may show Google's account and consent screens; else only a token without asking.
     *  scopes: what to ask for (Sync's Drive folder by default; Google Tasks asks for its own). */
    @PluginMethod
    public void googleAuthorize(PluginCall call) {
        boolean interactive = Boolean.TRUE.equals(call.getBoolean("interactive", false));
        Identity.getAuthorizationClient(getActivity())
            .authorize(request(call))
            .addOnSuccessListener((r) -> {
                if (!r.hasResolution()) {
                    resolveToken(call, r);
                } else if (!interactive || r.getPendingIntent() == null) {
                    call.reject("Signed out of Google.", "signed-out");
                } else {
                    waiting = call;
                    consent.launch(new IntentSenderRequest.Builder(r.getPendingIntent().getIntentSender()).build());
                }
            })
            .addOnFailureListener((e) -> {
                int code = e instanceof ApiException ? ((ApiException) e).getStatusCode() : -1;
                call.reject("Google sign-in failed (" + code + "): " + e.getMessage(), "failed");
            });
    }

    /** The window's colour, behind the status and navigation bars (where an older WebView can't draw),
     *  and light or dark icons on them. */
    @PluginMethod
    public void setBackground(PluginCall call) {
        String value = call.getString("color", "#ffffff");
        boolean dark = Boolean.TRUE.equals(call.getBoolean("dark", false));
        getActivity().runOnUiThread(() -> {
            Window window = getActivity().getWindow();
            WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(window, window.getDecorView());
            bars.setAppearanceLightStatusBars(!dark);
            bars.setAppearanceLightNavigationBars(!dark);
            try {
                int color = Color.parseColor(value);
                getActivity().getWindow().getDecorView().setBackgroundColor(color);
                getBridge().getWebView().setBackgroundColor(color);
            } catch (IllegalArgumentException ignored) {
            }
            call.resolve();
        });
    }

    // ── The in-app updater (src/lib/updater.ts) ─────────────────────────────────────────────
    // The new APK from GitHub Releases goes to the cache (checked against its SHA-256 when GitHub
    // gives one), then Android's installer opens on it. Same signing key, so it installs over Notes
    // and keeps everything.

    private File updateFile(String name) {
        File dir = new File(getContext().getCacheDir(), "updates");
        dir.mkdirs();
        return new File(dir, new File(name).getName());
    }

    /** Sends "updateProgress" events ({ progress: 0–1 }) while it downloads. */
    @PluginMethod
    public void downloadUpdate(PluginCall call) {
        String url = call.getString("url");
        String name = call.getString("name", "Notes.apk");
        String sha256 = call.getString("sha256");
        if (url == null) {
            call.reject("No download link.");
            return;
        }
        new Thread(() -> {
            File target = updateFile(name);
            try {
                File dir = target.getParentFile();
                File[] old = dir == null ? null : dir.listFiles();
                if (old != null) for (File f : old) f.delete();
                HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setInstanceFollowRedirects(true);
                conn.setConnectTimeout(20000);
                conn.setReadTimeout(30000);
                if (conn.getResponseCode() != 200) throw new Exception("GitHub answered " + conn.getResponseCode());
                long total = conn.getContentLengthLong();
                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                try (InputStream in = conn.getInputStream(); FileOutputStream out = new FileOutputStream(target)) {
                    byte[] buf = new byte[64 * 1024];
                    long done = 0;
                    double shown = 0;
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        out.write(buf, 0, n);
                        digest.update(buf, 0, n);
                        done += n;
                        double p = total > 0 ? (double) done / total : 0;
                        if (p - shown >= 0.01) {
                            shown = p;
                            JSObject ev = new JSObject();
                            ev.put("progress", p);
                            notifyListeners("updateProgress", ev);
                        }
                    }
                }
                if (sha256 != null && !sha256.isEmpty()) {
                    StringBuilder hex = new StringBuilder();
                    for (byte b : digest.digest()) hex.append(String.format("%02x", b));
                    if (!hex.toString().equalsIgnoreCase(sha256)) {
                        target.delete();
                        throw new Exception("the download didn't match its checksum");
                    }
                }
                JSObject out = new JSObject();
                out.put("path", target.getAbsolutePath());
                call.resolve(out);
            } catch (Exception e) {
                target.delete();
                call.reject(e.getMessage() == null ? "download failed" : e.getMessage());
            }
        }).start();
    }

    /**
     * Opens the installer on the downloaded APK. The first time, Android needs "Install unknown apps"
     * allowed for Notes: then this opens that switch instead and answers { needsPermission: true }.
     */
    @PluginMethod
    public void installUpdate(PluginCall call) {
        File apk = new File(call.getString("path", ""));
        JSObject out = new JSObject();
        if (!apk.exists()) {
            out.put("missing", true);
            call.resolve(out);
            return;
        }
        Activity activity = getActivity();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !activity.getPackageManager().canRequestPackageInstalls()) {
            Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.getPackageName()));
            activity.startActivity(settings);
            out.put("needsPermission", true);
            call.resolve(out);
            return;
        }
        Uri uri = FileProvider.getUriForFile(activity, activity.getPackageName() + ".fileprovider", apk);
        Intent install = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        activity.startActivity(install);
        call.resolve(out);
    }
}
