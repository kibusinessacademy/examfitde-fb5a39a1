import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { 
  Smartphone, 
  Apple, 
  PlayCircle, 
  Download, 
  CheckCircle2, 
  AlertCircle,
  Copy,
  ExternalLink,
  Terminal,
  FileCode,
  Package,
  Upload,
  Settings,
  Zap
} from 'lucide-react';
import { toast } from 'sonner';

interface BuildConfig {
  appName: string;
  appId: string;
  version: string;
  buildNumber: string;
  description: string;
  shortDescription: string;
  keywords: string;
  category: string;
  primaryColor: string;
}

interface BuildStep {
  id: string;
  title: string;
  description: string;
  command?: string;
  status: 'pending' | 'ready' | 'completed';
}

const defaultConfig: BuildConfig = {
  appName: 'ExamFit.de',
  appId: 'app.lovable.ad51e8f96cff41cf9723b4e49dbcd9db',
  version: '1.0.0',
  buildNumber: '1',
  description: 'Bereite dich optimal auf deine IHK-Prüfung vor. Interaktive Lernkurse, Prüfungstrainer mit echten Fragen und KI-gestützte mündliche Prüfungssimulation.',
  shortDescription: 'IHK Prüfungsvorbereitung mit KI-Unterstützung',
  keywords: 'IHK, Prüfung, Ausbildung, Azubi, Lernen, Prüfungsvorbereitung',
  category: 'Education',
  primaryColor: '#0F3D3E'
};

const iosBuildSteps: BuildStep[] = [
  { 
    id: 'export', 
    title: 'Projekt exportieren', 
    description: 'GitHub Export durchführen und lokal klonen',
    command: 'git clone https://github.com/YOUR_REPO/examfit.git && cd examfit',
    status: 'ready'
  },
  { 
    id: 'install', 
    title: 'Dependencies installieren', 
    description: 'NPM Pakete installieren',
    command: 'npm install',
    status: 'pending'
  },
  { 
    id: 'add-ios', 
    title: 'iOS Platform hinzufügen', 
    description: 'Capacitor iOS Platform initialisieren',
    command: 'npx cap add ios',
    status: 'pending'
  },
  { 
    id: 'build', 
    title: 'Produktions-Build erstellen', 
    description: 'Optimierten Build für iOS erstellen',
    command: 'npm run build && npx cap sync ios',
    status: 'pending'
  },
  { 
    id: 'xcode', 
    title: 'Xcode öffnen', 
    description: 'iOS-Projekt in Xcode öffnen',
    command: 'npx cap open ios',
    status: 'pending'
  },
  { 
    id: 'archive', 
    title: 'Archive erstellen', 
    description: 'In Xcode: Product → Archive',
    status: 'pending'
  },
  { 
    id: 'upload', 
    title: 'App Store Upload', 
    description: 'Via Xcode Organizer zu App Store Connect hochladen',
    status: 'pending'
  }
];

const androidBuildSteps: BuildStep[] = [
  { 
    id: 'export', 
    title: 'Projekt exportieren', 
    description: 'GitHub Export durchführen und lokal klonen',
    command: 'git clone https://github.com/YOUR_REPO/examfit.git && cd examfit',
    status: 'ready'
  },
  { 
    id: 'install', 
    title: 'Dependencies installieren', 
    description: 'NPM Pakete installieren',
    command: 'npm install',
    status: 'pending'
  },
  { 
    id: 'add-android', 
    title: 'Android Platform hinzufügen', 
    description: 'Capacitor Android Platform initialisieren',
    command: 'npx cap add android',
    status: 'pending'
  },
  { 
    id: 'build', 
    title: 'Produktions-Build erstellen', 
    description: 'Optimierten Build für Android erstellen',
    command: 'npm run build && npx cap sync android',
    status: 'pending'
  },
  { 
    id: 'studio', 
    title: 'Android Studio öffnen', 
    description: 'Android-Projekt in Android Studio öffnen',
    command: 'npx cap open android',
    status: 'pending'
  },
  { 
    id: 'sign', 
    title: 'Signed Bundle erstellen', 
    description: 'Build → Generate Signed Bundle/APK',
    status: 'pending'
  },
  { 
    id: 'upload', 
    title: 'Play Store Upload', 
    description: 'AAB-Datei in Google Play Console hochladen',
    status: 'pending'
  }
];

export default function AppStoreBuilderPage() {
  const [config, setConfig] = useState<BuildConfig>(defaultConfig);
  const [activeTab, setActiveTab] = useState('ios');
  const [completedSteps, setCompletedSteps] = useState<string[]>([]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('In Zwischenablage kopiert');
  };

  const toggleStep = (stepId: string) => {
    setCompletedSteps(prev => 
      prev.includes(stepId) 
        ? prev.filter(id => id !== stepId)
        : [...prev, stepId]
    );
  };

  const getProgress = (steps: BuildStep[]) => {
    return (completedSteps.filter(id => steps.some(s => s.id === id)).length / steps.length) * 100;
  };

  const generateAppStoreMetadata = () => {
    const metadata = {
      ios: {
        name: config.appName,
        bundleId: config.appId,
        version: config.version,
        build: config.buildNumber,
        category: 'EDUCATION',
        subcategory: 'EDUCATION_LANGUAGE',
        description: config.description,
        keywords: config.keywords.split(',').map(k => k.trim()),
        supportUrl: 'https://examfit.de/support',
        marketingUrl: 'https://examfit.de',
        privacyPolicyUrl: 'https://examfit.de/datenschutz'
      },
      android: {
        applicationId: config.appId,
        versionName: config.version,
        versionCode: parseInt(config.buildNumber),
        category: 'EDUCATION',
        shortDescription: config.shortDescription,
        fullDescription: config.description,
        featureGraphic: '1024x500 Feature Graphic',
        phoneScreenshots: '8 Screenshots (mindestens 2)',
        privacyPolicy: 'https://examfit.de/datenschutz'
      }
    };

    copyToClipboard(JSON.stringify(metadata, null, 2));
    toast.success('Store Metadata generiert und kopiert');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <Smartphone className="h-8 w-8 text-primary" />
          App Store Builder
        </h1>
        <p className="text-muted-foreground mt-2">
          Automatisierte Erstellung von iOS und Android Apps für Apple App Store und Google Play Store
        </p>
      </div>

      {/* Status Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-full bg-blue-500/10">
                <Zap className="h-6 w-6 text-blue-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">PWA Status</p>
                <p className="text-xl font-bold text-green-500">Aktiv</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-full bg-gray-500/10">
                <Apple className="h-6 w-6" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">iOS Build</p>
                <p className="text-xl font-bold">Bereit</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-full bg-green-500/10">
                <PlayCircle className="h-6 w-6 text-green-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Android Build</p>
                <p className="text-xl font-bold">Bereit</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            App-Konfiguration
          </CardTitle>
          <CardDescription>
            Grundlegende Einstellungen für beide Stores
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="appName">App Name</Label>
              <Input 
                id="appName"
                value={config.appName}
                onChange={(e) => setConfig({...config, appName: e.target.value})}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="appId">Bundle/Package ID</Label>
              <Input 
                id="appId"
                value={config.appId}
                onChange={(e) => setConfig({...config, appId: e.target.value})}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="version">Version</Label>
              <Input 
                id="version"
                value={config.version}
                onChange={(e) => setConfig({...config, version: e.target.value})}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="buildNumber">Build Number</Label>
              <Input 
                id="buildNumber"
                value={config.buildNumber}
                onChange={(e) => setConfig({...config, buildNumber: e.target.value})}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="shortDescription">Kurzbeschreibung (max. 80 Zeichen)</Label>
            <Input 
              id="shortDescription"
              value={config.shortDescription}
              onChange={(e) => setConfig({...config, shortDescription: e.target.value})}
              maxLength={80}
            />
            <p className="text-xs text-muted-foreground">{config.shortDescription.length}/80</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Beschreibung</Label>
            <Textarea 
              id="description"
              value={config.description}
              onChange={(e) => setConfig({...config, description: e.target.value})}
              rows={4}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="keywords">Keywords (kommagetrennt)</Label>
            <Input 
              id="keywords"
              value={config.keywords}
              onChange={(e) => setConfig({...config, keywords: e.target.value})}
            />
          </div>

          <Button onClick={generateAppStoreMetadata} className="w-full md:w-auto">
            <Package className="h-4 w-4 mr-2" />
            Store Metadata generieren
          </Button>
        </CardContent>
      </Card>

      {/* Build Steps */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="ios" className="gap-2">
            <Apple className="h-4 w-4" />
            iOS / App Store
          </TabsTrigger>
          <TabsTrigger value="android" className="gap-2">
            <PlayCircle className="h-4 w-4" />
            Android / Play Store
          </TabsTrigger>
        </TabsList>

        <TabsContent value="ios" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>iOS Build Pipeline</CardTitle>
                  <CardDescription>
                    Schritt-für-Schritt Anleitung für den App Store
                  </CardDescription>
                </div>
                <Badge variant="outline" className="gap-1">
                  <Apple className="h-3 w-3" />
                  Xcode erforderlich
                </Badge>
              </div>
              <Progress value={getProgress(iosBuildSteps)} className="mt-4" />
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Voraussetzungen</AlertTitle>
                <AlertDescription>
                  Mac mit macOS, Xcode (aktuellste Version), Apple Developer Account (99€/Jahr)
                </AlertDescription>
              </Alert>

              {iosBuildSteps.map((step, index) => (
                <div 
                  key={step.id}
                  className={`flex items-start gap-4 p-4 rounded-lg border transition-colors ${
                    completedSteps.includes(step.id) 
                      ? 'bg-green-500/5 border-green-500/20' 
                      : 'bg-muted/30'
                  }`}
                >
                  <button
                    onClick={() => toggleStep(step.id)}
                    className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                      completedSteps.includes(step.id)
                        ? 'bg-green-500 text-white'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {completedSteps.includes(step.id) ? (
                      <CheckCircle2 className="h-5 w-5" />
                    ) : (
                      <span className="font-mono text-sm">{index + 1}</span>
                    )}
                  </button>

                  <div className="flex-1 space-y-2">
                    <div className="flex items-center justify-between">
                      <h4 className="font-semibold">{step.title}</h4>
                    </div>
                    <p className="text-sm text-muted-foreground">{step.description}</p>
                    
                    {step.command && (
                      <div className="flex items-center gap-2 mt-2">
                        <code className="flex-1 text-xs bg-muted px-3 py-2 rounded font-mono">
                          {step.command}
                        </code>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => copyToClipboard(step.command!)}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              ))}

              <Separator />

              <div className="flex flex-wrap gap-2">
                <Button variant="outline" asChild>
                  <a href="https://developer.apple.com/app-store/review/guidelines/" target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4 mr-2" />
                    App Store Guidelines
                  </a>
                </Button>
                <Button variant="outline" asChild>
                  <a href="https://appstoreconnect.apple.com" target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4 mr-2" />
                    App Store Connect
                  </a>
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="android" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Android Build Pipeline</CardTitle>
                  <CardDescription>
                    Schritt-für-Schritt Anleitung für den Play Store
                  </CardDescription>
                </div>
                <Badge variant="outline" className="gap-1">
                  <Terminal className="h-3 w-3" />
                  Android Studio erforderlich
                </Badge>
              </div>
              <Progress value={getProgress(androidBuildSteps)} className="mt-4" />
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Voraussetzungen</AlertTitle>
                <AlertDescription>
                  Android Studio (aktuellste Version), Google Play Developer Account (25$ einmalig)
                </AlertDescription>
              </Alert>

              {androidBuildSteps.map((step, index) => (
                <div 
                  key={step.id}
                  className={`flex items-start gap-4 p-4 rounded-lg border transition-colors ${
                    completedSteps.includes(step.id) 
                      ? 'bg-green-500/5 border-green-500/20' 
                      : 'bg-muted/30'
                  }`}
                >
                  <button
                    onClick={() => toggleStep(step.id)}
                    className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                      completedSteps.includes(step.id)
                        ? 'bg-green-500 text-white'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {completedSteps.includes(step.id) ? (
                      <CheckCircle2 className="h-5 w-5" />
                    ) : (
                      <span className="font-mono text-sm">{index + 1}</span>
                    )}
                  </button>

                  <div className="flex-1 space-y-2">
                    <div className="flex items-center justify-between">
                      <h4 className="font-semibold">{step.title}</h4>
                    </div>
                    <p className="text-sm text-muted-foreground">{step.description}</p>
                    
                    {step.command && (
                      <div className="flex items-center gap-2 mt-2">
                        <code className="flex-1 text-xs bg-muted px-3 py-2 rounded font-mono">
                          {step.command}
                        </code>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => copyToClipboard(step.command!)}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              ))}

              <Separator />

              <div className="flex flex-wrap gap-2">
                <Button variant="outline" asChild>
                  <a href="https://play.google.com/console/about/guides/releasewithconfidence/" target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Play Store Guidelines
                  </a>
                </Button>
                <Button variant="outline" asChild>
                  <a href="https://play.google.com/console" target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Google Play Console
                  </a>
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Asset Checklist */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Asset Checkliste
          </CardTitle>
          <CardDescription>
            Benötigte Assets für beide Stores
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h4 className="font-semibold mb-3 flex items-center gap-2">
                <Apple className="h-4 w-4" />
                iOS App Store
              </h4>
              <ul className="space-y-2 text-sm">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  App Icon (1024x1024 PNG, keine Transparenz)
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  Screenshots iPhone 6.7" (1290x2796)
                </li>
                <li className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-yellow-500" />
                  Screenshots iPad 12.9" (2048x2732)
                </li>
                <li className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-yellow-500" />
                  App Preview Video (optional)
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  Datenschutzerklärung URL
                </li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-3 flex items-center gap-2">
                <PlayCircle className="h-4 w-4" />
                Google Play Store
              </h4>
              <ul className="space-y-2 text-sm">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  App Icon (512x512 PNG)
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  Feature Graphic (1024x500)
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  Phone Screenshots (min. 2, max. 8)
                </li>
                <li className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-yellow-500" />
                  Tablet Screenshots (7" und 10")
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  Datenschutzerklärung URL
                </li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
