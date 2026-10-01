import { useState } from "react";
import { useParams } from "wouter";
import { MahaWordmark } from "@/components/MahaLogo";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useInstallPrompt } from "@/hooks/use-install-prompt";
import { isIos, isAndroid, isMacOs } from "@/lib/push";
import { CheckCircle2, Download, Loader2, ArrowRight, ChevronDown } from "lucide-react";

type Platform = "android" | "iphone" | "windows" | "mac";
const PLATFORM_LABELS: Record<Platform, string> = {
  android: "Android", iphone: "iPhone/iPad", windows: "Windows", mac: "Mac",
};

function detectPlatform(): Platform {
  if (isIos()) return "iphone";
  if (isAndroid()) return "android";
  if (isMacOs()) return "mac";
  return "windows";
}

function Steps({ items }: { items: string[] }) {
  return (
    <ol className="flex flex-col gap-4">
      {items.map((text, index) => (
        <li key={text} className="flex items-start gap-3 text-sm leading-relaxed">
          <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-semibold">{index + 1}</span>
          <span>{text}</span>
        </li>
      ))}
    </ol>
  );
}

export default function Install() {
  const params = useParams<{ platform?: string }>();
  const requested = params.platform as Platform | undefined;
  const [platform, setPlatform] = useState<Platform>(() =>
    requested && Object.prototype.hasOwnProperty.call(PLATFORM_LABELS, requested) ? requested : detectPlatform()
  );
  const { canInstallNative, promptInstall, isInstalled, isInstalling } = useInstallPrompt();
  const [showHelp, setShowHelp] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [notice, setNotice] = useState("");

  async function handleInstall() {
    setNotice("");
    if (canInstallNative) {
      const confirmed = await promptInstall();
      setAccepted(confirmed);
      if (!confirmed) {
        setNotice("Installation was not completed. You can use the browser version or follow the steps below.");
        setShowHelp(true);
      }
    } else {
      setPlatform(detectPlatform());
      setShowHelp(true);
      setNotice(isIos()
        ? "Use your browser's Share menu to add MAHA to your Home Screen."
        : "This browser has not made an install prompt available. Follow the steps below, or open MAHA in your browser.");
    }
  }

  return (
    <main className="min-h-dvh flex flex-col items-center bg-background px-4 py-8 sm:py-12">
      <div className="flex flex-col items-center mb-6 sm:mb-8">
        <MahaWordmark width={200} />
      </div>
      <Card className="w-full max-w-lg shadow-lg" data-testid="card-install-guide">
        <CardContent className="p-5 sm:p-8 flex flex-col gap-5">
          <div className="text-center space-y-2">
            <h1 className="text-2xl font-semibold">{isInstalled ? "MAHA is installed" : "Install MAHA"}</h1>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Your partner platform, ready to open from your device.
            </p>
          </div>

          {isInstalled ? (
            <div className="flex flex-col items-center gap-3 text-center" role="status" data-testid="text-already-installed">
              <CheckCircle2 className="h-9 w-9 text-green-600 dark:text-green-500" aria-hidden="true" />
              <p className="text-sm">You are ready to use MAHA.</p>
            </div>
          ) : accepted ? (
            <p role="status" className="text-sm text-center" data-testid="text-install-requested">
              Installation requested. Follow any remaining browser prompts, then open MAHA.
            </p>
          ) : (
            <div className="space-y-3">
              <Button onClick={handleInstall} disabled={isInstalling} className="w-full h-12 text-base" data-testid="button-install-maha">
                {isInstalling ? <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4 mr-2" aria-hidden="true" />}
                {isInstalling ? "Waiting for confirmation…" : "Install MAHA"}
              </Button>
              <p className="text-xs text-muted-foreground text-center leading-relaxed" data-testid="text-install-explanation">
                {canInstallNative
                  ? "Your browser will ask you to confirm installation."
                  : isIos()
                    ? "On iPhone and iPad, installation uses Share → Add to Home Screen."
                    : "Opens the install prompt when available, or the steps for your device."}
              </p>
            </div>
          )}

          <Button asChild variant={isInstalled || accepted ? "default" : "outline"} className="w-full h-11">
            <a href="#/" data-testid="button-open-browser">
              {isInstalled || accepted ? "Open MAHA" : "Open in browser"}
              <ArrowRight className="h-4 w-4 ml-2" aria-hidden="true" />
            </a>
          </Button>
          {!isInstalled && !accepted && <p className="text-xs text-muted-foreground text-center -mt-2">You can use the platform without installing it.</p>}

          {notice && !isInstalled && <p role="status" className="text-sm leading-relaxed" data-testid="text-install-notice">{notice}</p>}

          {!isInstalled && (
            <div className="border-t pt-4">
              <button type="button" className="flex min-h-11 w-full items-center justify-between gap-2 text-sm font-medium"
                aria-expanded={showHelp} aria-controls="install-help" onClick={() => setShowHelp(v => !v)} data-testid="button-install-help">
                Installation help
                <ChevronDown aria-hidden="true" className={`h-4 w-4 transition-transform ${showHelp ? "rotate-180" : ""}`} />
              </button>
              <div id="install-help" hidden={!showHelp} className="pt-3">
                <Tabs value={platform} onValueChange={v => setPlatform(v as Platform)}>
                  <TabsList className="grid grid-cols-2 sm:grid-cols-4 h-auto w-full gap-1">
                    {(Object.keys(PLATFORM_LABELS) as Platform[]).map(p => (
                      <TabsTrigger key={p} value={p} data-testid={`tab-platform-${p}`} className="min-h-11 px-2 text-xs sm:text-sm">
                        {PLATFORM_LABELS[p]}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  <div className="mt-5">
                    <TabsContent value="iphone">
                      <Steps items={[
                        "Open this page in Safari, or another browser that offers Add to Home Screen. If you opened it inside an email app, open it in your browser first.",
                        "Tap Share, then Add to Home Screen. Turn on Open as Web App if that option appears.",
                        "Tap Add to confirm. Open MAHA from the new Home Screen icon.",
                      ]} />
                    </TabsContent>
                    <TabsContent value="android">
                      <Steps items={[
                        "Open this page in Chrome on your Android device.",
                        "Open the browser menu and choose Install app or Add to Home screen.",
                        "Confirm installation, then open MAHA from your device.",
                      ]} />
                    </TabsContent>
                    <TabsContent value="windows">
                      <Steps items={[
                        "Open this page in Chrome or Edge.",
                        "Use the install icon in the address bar, or the browser menu's Install app option.",
                        "Confirm installation. You can then open MAHA in its own window.",
                      ]} />
                    </TabsContent>
                    <TabsContent value="mac">
                      <Steps items={[
                        "In Safari on macOS Sonoma or later, choose File → Add to Dock.",
                        "In Chrome or Edge, use the install icon in the address bar or the browser menu's Install app option.",
                        "Confirm to add MAHA to your device.",
                      ]} />
                    </TabsContent>
                  </div>
                </Tabs>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground text-center mt-6" data-testid="text-app-credit">
        Webapp provided by Madden Medical e.U.
      </p>
    </main>
  );
}
