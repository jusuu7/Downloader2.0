import { Toaster } from "sonner";

import { defaultBackground } from "./theme/backgrounds";
import { defaultTheme } from "./theme/presets";
import { ThemeProvider } from "./theme/ThemeProvider";
import { DownloaderWorkbench } from "./widgets/DownloaderWorkbench";

function App() {
  return (
    <ThemeProvider theme={defaultTheme} background={defaultBackground}>
      <DownloaderWorkbench />
      <Toaster richColors position="top-center" />
    </ThemeProvider>
  );
}

export default App;
