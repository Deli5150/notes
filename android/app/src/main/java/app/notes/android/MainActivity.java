package app.notes.android;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    /** Opens on a new Quick Note (the Quick Settings tile, the app icon's shortcut). */
    public static final String NEW_NOTE = "app.notes.android.NEW_NOTE";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NotesNativePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
