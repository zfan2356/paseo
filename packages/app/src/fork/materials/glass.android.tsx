import { BlurTargetView, BlurView } from "expo-blur";
import {
  createContext,
  createRef,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import {
  AccessibilityInfo,
  PixelRatio,
  Platform,
  StyleSheet,
  View,
  type ViewProps,
} from "react-native";
import { withUnistyles } from "react-native-unistyles";
import { MATERIAL } from "./tokens";

// Android glass: expo-blur's RenderNode blur samples a BlurTargetView. A target may not contain a
// BlurView that samples it, so every glass surface blurs a sibling target, never an ancestor.

type Target = RefObject<View | null>;

// RenderNode blur needs Android 12 (API 31). Older versions get the protected fill.
const SUPPORTS_BLUR = typeof Platform.Version === "number" && Platform.Version >= 31;

// CSS blur(Npx) is a Gaussian with sigma N dp. RenderEffect takes a radius in px and converts it
// with sigma = 0.57735 * radius + 0.5.
const BLUR_RADIUS_PX = (MATERIAL.glass.blur * PixelRatio.get() - 0.5) / 0.57735;
// expo-blur divides intensity by the reduction factor to get the radius, and also derives its
// tint alpha from intensity. Intensity 1 keeps that tint near zero; the palette fill below tints.
const BLUR_INTENSITY = 1;
const BLUR_REDUCTION = BLUR_INTENSITY / BLUR_RADIUS_PX;

const appTarget = createRef<View>();
const ScopeTarget = createContext<Target | null>(null);

/**
 * Android exposes no "reduce transparency" setting to React Native. High-contrast text is the
 * closest accessibility signal, so it switches glass to the protected fill.
 */
function useBlurAvailable(): boolean {
  const [highContrast, setHighContrast] = useState(false);
  useEffect(() => {
    if (!SUPPORTS_BLUR) return;
    let live = true;
    const read = async () => {
      const enabled = await AccessibilityInfo.isHighTextContrastEnabled();
      if (live) setHighContrast(enabled);
    };
    void read();
    const subscription = AccessibilityInfo.addEventListener(
      "highTextContrastChanged",
      setHighContrast,
    );
    return () => {
      live = false;
      subscription.remove();
    };
  }, []);
  return SUPPORTS_BLUR && !highContrast;
}

function GlassFillView({
  target,
  colorScheme,
  radius = 0,
}: {
  target: Target;
  colorScheme: "light" | "dark";
  radius?: number;
}) {
  const blur = useBlurAvailable();
  const palette = MATERIAL[colorScheme];
  const opacity = blur ? MATERIAL.glass.opacity : MATERIAL.elevation.hint.material.minimumOpacity;
  const corners = { borderTopLeftRadius: radius, borderTopRightRadius: radius };
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.clip, corners]}>
      {blur ? (
        <BlurView
          blurTarget={target}
          blurMethod="dimezisBlurViewSdk31Plus"
          intensity={BLUR_INTENSITY}
          blurReductionFactor={BLUR_REDUCTION}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: palette.surface, opacity }]} />
    </View>
  );
}

const GlassFill = withUnistyles(GlassFillView, (theme) => ({ colorScheme: theme.colorScheme }));
const SheetGlassFill = withUnistyles(GlassFillView, (theme) => ({
  colorScheme: theme.colorScheme,
  radius: theme.borderRadius["2xl"],
}));

export function GlassAppTarget({ children }: { children: ReactNode }) {
  return (
    <BlurTargetView ref={appTarget} style={styles.fill}>
      {children}
    </BlurTargetView>
  );
}

export function GlassScope(props: ViewProps) {
  const target = useRef<View>(null);
  return (
    <ScopeTarget.Provider value={target}>
      <View {...props} />
    </ScopeTarget.Provider>
  );
}

export function GlassTarget(props: ViewProps) {
  const target = useContext(ScopeTarget);
  if (!target) return <View {...props} />;
  return <BlurTargetView ref={target} {...props} />;
}

/** The glass header replaces the upstream fade. */
export function GlassFade(_props: { children: ReactNode }) {
  return null;
}

/** Glass behind a floating header, sampling the scope's target. */
export function GlassHeaderFill() {
  const target = useContext(ScopeTarget);
  if (!target) return null;
  return <GlassFill target={target} />;
}

export function GlassSheetFill() {
  return <SheetGlassFill target={appTarget} />;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  clip: { overflow: "hidden" },
});
