package app.notes.android;

import android.graphics.Color;
import android.view.Window;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** What the page (src/lib/android.ts) asks of the Android side. */
@CapacitorPlugin(name = "NotesNative")
public class NotesNativePlugin extends Plugin {

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
}
