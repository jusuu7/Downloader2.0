import dawnImage from "../assets/island-dawn.png";
import type { BackgroundPreset } from "./types";

export const defaultBackground: BackgroundPreset = {
  id: "island-dawn",
  label: "岛屿晨雾",
  imageSrc: dawnImage,
  base: "linear-gradient(145deg, rgba(216, 224, 219, 0.94), rgba(201, 213, 205, 0.92) 42%, rgba(189, 202, 195, 0.94) 100%)",
  overlay:
    "linear-gradient(180deg, rgba(252, 248, 241, 0.34), rgba(233, 239, 234, 0.74)), radial-gradient(circle at 16% 18%, rgba(241, 198, 175, 0.22), transparent 18%), radial-gradient(circle at 82% 14%, rgba(182, 219, 202, 0.24), transparent 18%), radial-gradient(circle at 48% 72%, rgba(205, 213, 240, 0.14), transparent 16%)",
  blur: "10px",
  brightness: "0.9",
};
