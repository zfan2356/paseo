import { nativeTheme } from "electron";
import { createWindowMaterial } from "./material-controller.js";

const material = createWindowMaterial(process.platform, nativeTheme);
export const materialWindowOptions = material.options;
export const updateMaterialBackground = material.updateBackground;
export const setupWindowMaterial = material.setup;
