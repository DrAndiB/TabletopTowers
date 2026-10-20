package lu.andreasbraun.tabletoptowers;

import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

// The game runs full screen and sideways (the castles face each other across the table): system bars
// hidden (a swipe from the edge shows them briefly), the screen stays on, drawing extends into the
// camera cutout, and the back button steps through the game's menus.
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(lp);
        }
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        hideSystemBars();

        // Back: pause during a game, one step back in the menus; on the title screen the app goes to the
        // background (the game decides, see window.__ttBack in js/main.js).
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView web = bridge != null ? bridge.getWebView() : null;
                if (web == null) {
                    moveTaskToBack(true);
                    return;
                }
                web.evaluateJavascript("(window.__ttBack ? window.__ttBack() : 'exit')", (result) -> {
                    if ("\"exit\"".equals(result)) moveTaskToBack(true);
                });
            }
        });
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    private void hideSystemBars() {
        WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        bars.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        bars.hide(WindowInsetsCompat.Type.systemBars());
    }
}
