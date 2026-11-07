package com.redline.multitracks;

import android.os.Build;
import android.os.Bundle;
import android.view.Display;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestHighestRefreshRate();
        resizeWithKeyboard();
    }

    /**
     * Con "adjustMarginsForEdgeToEdge: force" Capacitor consume los insets de las barras del sistema pero ignora el del teclado,
     * y en Android 15 (borde a borde) el teclado acaba tapando la parte baja de la app. Aquí se vuelve a poner el mismo margen
     * incluyendo el teclado (ime): el WebView se encoge hasta el área visible y la página puede hacer scroll en ella.
     */
    private void resizeWithKeyboard() {
        try {
            View web = getBridge().getWebView();
            ViewCompat.setOnApplyWindowInsetsListener(web, (v, windowInsets) -> {
                Insets insets = windowInsets.getInsets(
                        WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout() | WindowInsetsCompat.Type.ime());
                ViewGroup.MarginLayoutParams params = (ViewGroup.MarginLayoutParams) v.getLayoutParams();
                params.leftMargin = insets.left;
                params.topMargin = insets.top;
                params.rightMargin = insets.right;
                params.bottomMargin = insets.bottom;
                v.setLayoutParams(params);
                return WindowInsetsCompat.CONSUMED;
            });
            ViewCompat.requestApplyInsets(web);
        } catch (Exception ignored) {
            // Si algo falla, queda el comportamiento de Capacitor.
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        requestHighestRefreshRate();
    }

    /**
     * Pide a Android la mayor frecuencia de pantalla disponible (90/120 Hz) con la resolución actual.
     * Sin esto, muchos teléfonos limitan las aplicaciones web a 60 Hz.
     */
    private void requestHighestRefreshRate() {
        try {
            Display display;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                display = getDisplay();
            } else {
                display = getWindowManager().getDefaultDisplay();
            }
            if (display == null) return;

            Display.Mode current = display.getMode();
            Display.Mode best = current;
            for (Display.Mode mode : display.getSupportedModes()) {
                boolean sameSize = mode.getPhysicalWidth() == current.getPhysicalWidth()
                        && mode.getPhysicalHeight() == current.getPhysicalHeight();
                if (sameSize && mode.getRefreshRate() > best.getRefreshRate()) {
                    best = mode;
                }
            }

            WindowManager.LayoutParams params = getWindow().getAttributes();
            params.preferredDisplayModeId = best.getModeId();
            params.preferredRefreshRate = best.getRefreshRate();
            getWindow().setAttributes(params);
        } catch (Exception ignored) {
            // Si el teléfono no permite elegir la frecuencia, se queda con la predeterminada.
        }
    }
}
