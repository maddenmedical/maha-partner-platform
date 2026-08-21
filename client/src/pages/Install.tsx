import { useEffect, useState } from "react";
import { useParams } from "wouter";
import { MahaWordmark } from "@/components/MahaLogo";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useInstallPrompt } from "@/hooks/use-install-prompt";
import { isIos, isAndroid, isMacOs, isWindows, isStandalone } from "@/lib/push";
import { Smartphone, Monitor, Apple, Share, SquarePlus, MoreVertical, PlusSquare, CheckCircle2, Download, Loader2 } from "lucide-react";

type Platform = "android" | "iphone" | "windows" | "mac";

const PLATFORM_LABELS: Record<Platform, string> = {
  android: "Android",
  iphone: "iPhone",
  windows: "Windows",
  mac: "Mac",
};

const PLATFORM_ICONS: Record<Platform, typeof Smartphone> = {
  android: Smartphone,
  iphone: Apple,
  windows: Monitor,
  mac: Monitor,
};

function detectPlatform(): Platform {
  if (isAndroid()) return "android";
  if (isIos()) return "iphone";
  if (isMacOs()) return "mac";
  if (isWindows()) return "windows";
  return "android";
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
        <span className="text-sm font-semibold text-primary">{n}</span>
      </div>
      <div className="flex items-center gap-2 text-sm flex-wrap">{children}</div>
    </div>
  );
}

const IconChip = ({ icon: Icon }: { icon: typeof Share }) => (
  <span className="inline-flex items-center justify-center h-7 w-7 rounded-md border border-border bg-muted shrink-0">
    <Icon className="h-3.5 w-3.5" />
  </span>
);

function AndroidGuide() {
  const { canInstallNative, promptInstall } = useInstallPrompt();
  const [installing, setInstalling] = useState(false);
  const [done, setDone] = useState(false);

  async function handleInstall() {
    setInstalling(true);
    try {
      const accepted = await promptInstall();
      if (accepted) setDone(true);
    } finally {
      setInstalling(false);
    }
  }

  if (done) {
    return (
      <div className="flex flex-col items-center gap-3 text-center py-6" data-testid="text-install-done-android">
        <CheckCircle2 className="h-10 w-10 text-green-600 dark:text-green-500" />
        <p className="text-sm font-medium">Installed — look for MAHA on your home screen.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted-foreground">Open this page in Chrome on your Android phone or tablet, then tap Install.</p>
      {canInstallNative ? (
        <Button onClick={handleInstall} disabled={installing} className="w-full h-12 text-base" data-testid="button-install-android">
          {installing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
          Install MAHA app
        </Button>
      ) : (
        <div className="flex flex-col gap-4">
          <Step n={1}>
            <span>Open this link in Chrome, then tap</span>
            <IconChip icon={MoreVertical} />
            <span>in the top right</span>
          </Step>
          <Step n={2}>
            <span>Tap</span>
            <span className="font-medium">Install app</span>
            <span>or</span>
            <span className="font-medium">Add to Home screen</span>
          </Step>
          <Step n={3}>
            <span>Confirm — the MAHA icon appears on your home screen.</span>
          </Step>
        </div>
      )}
    </div>
  );
}

function IosGuide() {
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted-foreground">For iPhone and iPad. Only Safari can install to your home screen — open this link in Safari first, even if you tapped it from another app.</p>
      <div className="flex flex-col gap-4">
        <Step n={1}>
          <span>Tap the</span>
          <IconChip icon={Share} />
          <span>Share button in Safari's toolbar</span>
        </Step>
        <Step n={2}>
          <span>Scroll down and tap</span>
          <IconChip icon={SquarePlus} />
          <span>"Add to Home Screen"</span>
        </Step>
        <Step n={3}>
          <span>Tap <span className="font-medium">Add</span> in the top right — done.</span>
        </Step>
      </div>
    </div>
  );
}

function DesktopGuide({ platform }: { platform: "windows" | "mac" }) {
  const { canInstallNative, promptInstall } = useInstallPrompt();
  const [installing, setInstalling] = useState(false);
  const [done, setDone] = useState(false);

  async function handleInstall() {
    setInstalling(true);
    try {
      const accepted = await promptInstall();
      if (accepted) setDone(true);
    } finally {
      setInstalling(false);
    }
  }

  if (done) {
    return (
      <div className="flex flex-col items-center gap-3 text-center py-6" data-testid={`text-install-done-${platform}`}>
        <CheckCircle2 className="h-10 w-10 text-green-600 dark:text-green-500" />
        <p className="text-sm font-medium">Installed — MAHA now opens like a desktop app.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted-foreground">Open this link in Chrome or Edge on your {platform === "windows" ? "Windows PC" : "Mac"} to install it as a standalone app.</p>
      {canInstallNative ? (
        <Button onClick={handleInstall} disabled={installing} className="w-full h-12 text-base" data-testid={`button-install-${platform}`}>
          {installing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
          Install MAHA app
        </Button>
      ) : (
        <div className="flex flex-col gap-4">
          <Step n={1}>
            <span>In the address bar, click the</span>
            <IconChip icon={PlusSquare} />
            <span>install icon (Chrome/Edge)</span>
          </Step>
          <Step n={2}>
            <span>Or open the</span>
            <IconChip icon={MoreVertical} />
            <span>menu and choose "Install MAHA Partner Portal" / "Apps &rarr; Install this site as an app"</span>
          </Step>
          <Step n={3}>
            <span>Confirm — MAHA opens in its own window and pins to your {platform === "windows" ? "taskbar" : "Dock"}.</span>
          </Step>
        </div>
      )}
      {platform === "mac" && (
        <p className="text-xs text-muted-foreground border-t border-border pt-3">
          Using Safari on macOS Sonoma or later? Open the <span className="font-medium">File</span> menu and choose <span className="font-medium">Add to Dock</span> instead.
        </p>
      )}
    </div>
  );
}

export default function Install() {
  const params = useParams<{ platform?: string }>();
  const requested = params.platform as Platform | undefined;
  const [platform, setPlatform] = useState<Platform>(() =>
    requested && requested in PLATFORM_LABELS ? requested : detectPlatform()
  );
  const [alreadyInstalled, setAlreadyInstalled] = useState(false);

  useEffect(() => {
    setAlreadyInstalled(isStandalone());
  }, []);

  return (
    <div className="min-h-dvh flex flex-col items-center bg-background px-4 py-12">
      <div className="flex flex-col items-center gap-2 mb-8">
        <MahaWordmark width={220} />
        <p className="text-base text-muted-foreground text-center">Install the MAHA Partner Portal app</p>
      </div>

      <Card className="w-full max-w-lg shadow-lg" data-testid="card-install-guide">
        <CardContent className="p-6 sm:p-8 flex flex-col gap-6">
          {alreadyInstalled ? (
            <div className="flex flex-col items-center gap-3 text-center py-6" data-testid="text-already-installed">
              <CheckCircle2 className="h-10 w-10 text-green-600 dark:text-green-500" />
              <p className="text-sm font-medium">MAHA is already installed on this device.</p>
            </div>
          ) : (
            <Tabs value={platform} onValueChange={(v) => setPlatform(v as Platform)}>
              <TabsList className="grid grid-cols-4 w-full">
                {(Object.keys(PLATFORM_LABELS) as Platform[]).map((p) => {
                  const Icon = PLATFORM_ICONS[p];
                  return (
                    <TabsTrigger key={p} value={p} data-testid={`tab-platform-${p}`} className="px-1.5 sm:px-3">
                      <Icon className="h-3.5 w-3.5 shrink-0 sm:mr-1.5" />
                      <span className="hidden sm:inline truncate">{PLATFORM_LABELS[p]}</span>
                    </TabsTrigger>
                  );
                })}
              </TabsList>
              <div className="mt-6">
                <TabsContent value="android"><AndroidGuide /></TabsContent>
                <TabsContent value="iphone"><IosGuide /></TabsContent>
                <TabsContent value="windows"><DesktopGuide platform="windows" /></TabsContent>
                <TabsContent value="mac"><DesktopGuide platform="mac" /></TabsContent>
              </div>
            </Tabs>
          )}
        </CardContent>
      </Card>

      <p className="text-[10px] text-muted-foreground/40 mt-8" data-testid="text-app-credit">
        Webapp provided by Madden Medical e.U.
      </p>
    </div>
  );
}
