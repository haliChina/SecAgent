import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import { PresetCombobox } from "./PresetCombobox.js";
import { SelectCombobox } from "./SelectCombobox.js";
import { emptyProvider } from "../utils.js";
import { filterRecommendedCompanionApps } from "../companion-recommend.js";
import { isClassIslandTargetReady, isClassWidgetsTargetReady, isIccceTargetReady, isSecRandomTargetReady, latestCompatibleVersion } from "./OobeWizardHelpers.js";
import { OobePluginCard } from "./OobePluginCard.js";

type SourcePath = "official" | "custom";
type OobeStep = "source" | "config" | "plugins";
type OobePageDirection = "forward" | "back";

const OOBE_STEP_ORDER: OobeStep[] = ["source", "config", "plugins"];

export function OobeWizard() {
  const bridge = window.secagent;
  const [step, setStep] = useState<OobeStep>("source");
  const [pageTransition, setPageTransition] = useState<"idle" | "exit" | "enter">("idle");
  const [pageDirection, setPageDirection] = useState<OobePageDirection>("forward");
  const transitionTimer = useRef<number | undefined>(undefined);
  const [introPhase, setIntroPhase] = useState<"intro" | "transition" | "complete">("intro");
  const introTimer = useRef<number | undefined>(undefined);
  const [source, setSource] = useState<SourcePath | null>(null);
  const [settings, setSettings] = useState<SettingsPayload | null>(null);
  const [presets, setPresets] = useState<ProviderPreset[]>([]);
  const [provider, setProvider] = useState<ProviderConfig>(() => emptyProvider());
  const [newModelId, setNewModelId] = useState("");
  const [officialLoggedIn, setOfficialLoggedIn] = useState(false);
  const [officialEmail, setOfficialEmail] = useState("");
  const [officialBusy, setOfficialBusy] = useState(false);
  const [apps, setApps] = useState<DetectedCompanionApp[]>([]);
  const [companionDetectionReady, setCompanionDetectionReady] = useState(false);
  const [plugins, setPlugins] = useState<PluginStatus[]>([]);
  const [marketPlugins, setMarketPlugins] = useState<MarketplacePlugin[]>([]);
  const [marketError, setMarketError] = useState("");
  const [installingId, setInstallingId] = useState("");
  const [saProgress, setSaProgress] = useState<Record<string, number>>({});
  // True while the one-click batch ("install all") is running, including the
  // SecAgent-half phase. Keeps each card's bar from collapsing between the
  // SecAgent half finishing and the companion half starting.
  const [batchActive, setBatchActive] = useState(false);
  // Monotonic high-water marks for the companion halves so the visible bar
  // never regresses mid-install even if a late event carries a lower percent.
  const [companionHighWater, setCompanionHighWater] = useState<Record<string, number>>({});
  // After a failed install the card keeps its last progress position (plus the
  // per-target failure reasons) instead of snapping back to zero.
  const [cardProgressHold, setCardProgressHold] = useState<Record<string, number>>({});
  // Latest companion-half percent per pluginId, kept in a ref so failure paths
  // (which run after awaits) can read the current value without stale closures.
  const companionPercentRef = useRef<Record<string, number>>({});
  // Same for the SecAgent-side percent, so a failed connector install can
  // keep its last progress position on the card.
  const saPercentRef = useRef<Record<string, number>>({});
  const [batchSecAgentTargets, setBatchSecAgentTargets] = useState<Record<string, boolean>>({});
  const [batchCompanionTargets, setBatchCompanionTargets] = useState<{ classIsland?: string[]; secRandom?: string[]; iccce?: string[]; cw?: string[] }>({});
  const [classIslandTargets, setClassIslandTargets] = useState<ClassIslandInstallCandidate[]>([]);
  const [classIslandSelectedIds, setClassIslandSelectedIds] = useState<string[]>([]);
  const [classIslandTargetsExpanded, setClassIslandTargetsExpanded] = useState(true);
  const [classIslandResults, setClassIslandResults] = useState<Record<string, ClassIslandInstallResult>>({});
  const [classIslandPhase, setClassIslandPhase] = useState<ClassIslandInstallPhase | "idle">("idle");
  const [classIslandProgressPercent, setClassIslandProgressPercent] = useState(0);
  const [secRandomTargets, setSecRandomTargets] = useState<SecRandomInstallCandidate[]>([]);
  const [secRandomSelectedIds, setSecRandomSelectedIds] = useState<string[]>([]);
  const [secRandomTargetsExpanded, setSecRandomTargetsExpanded] = useState(true);
  const [secRandomResults, setSecRandomResults] = useState<Record<string, SecRandomInstallResult>>({});
  const [secRandomPhase, setSecRandomPhase] = useState<SecRandomInstallProgress["phase"] | "idle">("idle");
  const [secRandomProgressPercent, setSecRandomProgressPercent] = useState(0);
  const [iccceTargets, setIccceTargets] = useState<IccceInstallCandidate[]>([]);
  const [iccceSelectedIds, setIccceSelectedIds] = useState<string[]>([]);
  const [iccceTargetsExpanded, setIccceTargetsExpanded] = useState(true);
  const [iccceResults, setIccceResults] = useState<Record<string, IccceInstallResult>>({});
  const [icccePhase, setIcccePhase] = useState<IccceInstallProgress["phase"] | "idle">("idle");
  const [iccceProgressPercent, setIccceProgressPercent] = useState(0);
  const [cwTargets, setCwTargets] = useState<ClassWidgetsInstallCandidate[]>([]);
  const [cwSelectedIds, setCwSelectedIds] = useState<string[]>([]);
  const [cwTargetsExpanded, setCwTargetsExpanded] = useState(true);
  const [cwResults, setCwResults] = useState<Record<string, ClassWidgetsInstallResult>>({});
  const [cwPhase, setCwPhase] = useState<ClassWidgetsInstallProgress["phase"] | "idle">("idle");
  const [cwProgressPercent, setCwProgressPercent] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [progressReady, setProgressReady] = useState(false);
  const [pluginsReveal, setPluginsReveal] = useState(false);

  useEffect(() => () => {
    if (transitionTimer.current !== undefined) window.clearTimeout(transitionTimer.current);
    if (introTimer.current !== undefined) window.clearTimeout(introTimer.current);
  }, []);

  const beginIntro = () => {
    if (introPhase !== "intro") return;
    setIntroPhase("transition");
    introTimer.current = window.setTimeout(() => {
      setIntroPhase("complete");
      introTimer.current = undefined;
    }, 560);
  };

  const goToStep = (nextStep: OobeStep) => {
    if (nextStep === step || pageTransition !== "idle") return;
    const currentIndex = OOBE_STEP_ORDER.indexOf(step);
    const nextIndex = OOBE_STEP_ORDER.indexOf(nextStep);
    setPageDirection(nextIndex > currentIndex ? "forward" : "back");
    setPageTransition("exit");
    transitionTimer.current = window.setTimeout(() => {
      setStep(nextStep);
      setPageTransition("enter");
      transitionTimer.current = window.setTimeout(() => {
        setPageTransition("idle");
        transitionTimer.current = undefined;
      }, 240);
    }, 160);
  };

  useEffect(() => {
    let disposed = false;
    // Keep the plugin list hidden until every local-app probe has settled.
    // Each probe has a safe empty fallback so one unavailable detector cannot
    // leave the OOBE spinner running forever.
    void Promise.all([
      bridge.detectInstalledApps().catch(() => [] as DetectedCompanionApp[]),
      bridge.detectClassIslandInstallations().catch(() => [] as ClassIslandInstallCandidate[]),
      bridge.detectSecRandomInstallations().catch(() => [] as SecRandomInstallCandidate[]),
      bridge.detectIccceInstallations().catch(() => [] as IccceInstallCandidate[]),
      bridge.detectClassWidgetsInstallations().catch(() => [] as ClassWidgetsInstallCandidate[])
    ]).then(([detectedApps, classIslandTargets, secRandomTargets, iccceTargets, cwTargets]) => {
      if (disposed) return;
      setApps(detectedApps);
      setClassIslandTargets(classIslandTargets);
      setClassIslandTargetsExpanded(classIslandTargets.length !== 1);
      setClassIslandSelectedIds((current) => {
        const validCurrent = current.filter((id) => classIslandTargets.some((target) => target.id === id && target.compatible));
        if (validCurrent.length) return validCurrent;
        const running = classIslandTargets.filter((target) => target.compatible && target.isRunning).map((target) => target.id);
        if (running.length) return running;
        const compatible = classIslandTargets.filter((target) => target.compatible);
        return compatible.length === 1 ? [compatible[0].id] : [];
      });
      setSecRandomTargets(secRandomTargets);
      setSecRandomTargetsExpanded(secRandomTargets.length !== 1);
      setSecRandomSelectedIds((current) => {
        const validCurrent = current.filter((id) => secRandomTargets.some((target) => target.id === id && target.compatible));
        if (validCurrent.length) return validCurrent;
        const running = secRandomTargets.filter((target) => target.compatible && target.isRunning).map((target) => target.id);
        if (running.length) return running;
        const compatible = secRandomTargets.filter((target) => target.compatible);
        return compatible.length === 1 ? [compatible[0].id] : [];
      });
      setIccceTargets(iccceTargets);
      setIccceTargetsExpanded(iccceTargets.length !== 1);
      setIccceSelectedIds((current) => {
        const validCurrent = current.filter((id) => iccceTargets.some((target) => target.id === id && target.compatible));
        if (validCurrent.length) return validCurrent;
        const running = iccceTargets.filter((target) => target.compatible && target.isRunning).map((target) => target.id);
        if (running.length) return running;
        const compatible = iccceTargets.filter((target) => target.compatible);
        return compatible.length === 1 ? [compatible[0].id] : [];
      });
      setCwTargets(cwTargets);
      setCwTargetsExpanded(cwTargets.length !== 1);
      setCwSelectedIds((current) => {
        const validCurrent = current.filter((id) => cwTargets.some((target) => target.id === id && target.compatible));
        if (validCurrent.length) return validCurrent;
        const running = cwTargets.filter((target) => target.compatible && target.isRunning).map((target) => target.id);
        if (running.length) return running;
        const compatible = cwTargets.filter((target) => target.compatible);
        return compatible.length === 1 ? [compatible[0].id] : [];
      });
    }).finally(() => {
      if (!disposed) setCompanionDetectionReady(true);
    });
    void Promise.all([
      bridge.getSettings(),
      bridge.listProviders(),
      bridge.officialStatus(),
      bridge.getOobeProgress()
    ]).then(([loadedSettings, loadedPresets, status, savedProgress]) => {
      if (disposed) return;
      setSettings(loadedSettings);
      setPresets(loadedPresets);
      setOfficialLoggedIn(status.loggedIn);
      setOfficialEmail(status.email);

      // Older builds already persisted the login token but did not persist OOBE progress.
      // Treat that state as the official service configuration page when onboarding resumes.
      const progress = savedProgress || (status.loggedIn ? { step: "config" as const, source: "official" as const } : undefined);
      if (progress) {
        setStep(progress.step);
        setSource(progress.source || null);
        if (progress.provider) setProvider({ ...emptyProvider(), ...progress.provider, models: progress.provider.models.map((model) => ({ ...model })) });
        setIntroPhase("complete");
      }
      setProgressReady(true);
    }).catch((reason) => {
      if (disposed) return;
      setError(String(reason));
      setProgressReady(true);
    });
    return () => { disposed = true; };
  }, [bridge]);

  useEffect(() => {
    if (step !== "plugins") return;
    let disposed = false;
    void Promise.all([
      bridge.listPlugins(),
      bridge.listMarketplace().catch((reason) => {
        if (!disposed) setMarketError(reason instanceof Error ? reason.message : String(reason));
        return [] as MarketplacePlugin[];
      })
    ]).then(([installed, market]) => {
      if (disposed) return;
      setPlugins(installed);
      setMarketPlugins(market);
    }).catch((reason) => { if (!disposed) setError(String(reason)); });
    return () => { disposed = true; };
  }, [bridge, step]);

  useEffect(() => bridge.onClassIslandProgress((progress) => {
    if (progress?.phase) setClassIslandPhase(progress.phase);
    if (typeof progress?.percent === "number") {
      setClassIslandProgressPercent(progress.percent);
      companionPercentRef.current["classisland-connector"] = progress.percent;
      setCompanionHighWater((current) => progress.percent! > (current["classisland-connector"] ?? 0)
        ? { ...current, "classisland-connector": progress.percent! }
        : current);
    }
  }), [bridge]);

  useEffect(() => bridge.onSecRandomProgress((progress) => {
    if (progress?.phase) setSecRandomPhase(progress.phase);
    if (typeof progress?.percent === "number") {
      setSecRandomProgressPercent(progress.percent);
      companionPercentRef.current["secrandom"] = progress.percent;
      setCompanionHighWater((current) => progress.percent! > (current["secrandom"] ?? 0)
        ? { ...current, "secrandom": progress.percent! }
        : current);
    }
  }), [bridge]);

  useEffect(() => bridge.onIccceProgress((progress) => {
    if (progress?.phase) setIcccePhase(progress.phase);
    if (typeof progress?.percent === "number") {
      setIccceProgressPercent(progress.percent);
      companionPercentRef.current["iccce-connector"] = progress.percent;
      setCompanionHighWater((current) => progress.percent! > (current["iccce-connector"] ?? 0)
        ? { ...current, "iccce-connector": progress.percent! }
        : current);
    }
  }), [bridge]);

  useEffect(() => bridge.onClassWidgetsProgress((progress) => {
    if (progress?.phase) setCwPhase(progress.phase);
    if (typeof progress?.percent === "number") {
      setCwProgressPercent(progress.percent);
      companionPercentRef.current["class-widgets"] = progress.percent;
      setCompanionHighWater((current) => progress.percent! > (current["class-widgets"] ?? 0)
        ? { ...current, "class-widgets": progress.percent! }
        : current);
    }
  }), [bridge]);

  useEffect(() => {
    setPluginsReveal(false);
    if (step !== "plugins") return;
    const timer = window.setTimeout(() => setPluginsReveal(true), 0);
    return () => window.clearTimeout(timer);
  }, [step]);

  const updateProvider = (patch: Partial<ProviderConfig>) => setProvider((current) => ({ ...current, ...patch }));
  const applyPreset = (presetId: string) => {
    if (presetId === "custom") { updateProvider({ preset: "custom" }); return; }
    const preset = presets.find((item) => item.id === presetId);
    if (!preset) return;
    const env = `${preset.name.replace(/[^A-Za-z0-9]/g, "").toUpperCase()}_API_KEY`;
    const isAnthropic = /anthropic/i.test(preset.id);
    const isGoogle = /google|gemini/i.test(preset.id);
    const baseUrl = isAnthropic || isGoogle || !preset.api || /\/v1(?:beta)?\/?$/i.test(preset.api) ? preset.api : `${preset.api.replace(/\/$/, "")}/v1`;
    updateProvider({
      preset: preset.id,
      name: preset.name,
      apiKeyEnv: env,
      baseUrl: baseUrl || provider.baseUrl,
      provider: isGoogle ? "google" : isAnthropic ? "anthropic" : "openai-compatible",
      endpoint: isGoogle ? "" : isAnthropic ? "/v1/messages" : "/chat/completions",
      models: preset.models.map((model) => ({ id: model.id, name: model.name || model.id, enabled: true }))
    });
  };

  const persist = async (payload: SettingsPayload) => {
    const saved = await bridge.saveSettings(payload);
    setSettings(saved);
    return saved;
  };

  const saveProgress = async (progress: OobeProgress) => {
    await bridge.saveOobeProgress(progress);
  };

  const chooseSource = async (nextSource: SourcePath) => {
    setError("");
    try {
      await saveProgress({ step: "config", source: nextSource, ...(nextSource === "custom" ? { provider } : {}) });
      setSource(nextSource);
      goToStep("config");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  useEffect(() => {
    if (!progressReady || step !== "config" || source !== "custom") return;
    const timer = window.setTimeout(() => {
      void bridge.saveOobeProgress({ step: "config", source, provider }).catch(() => undefined);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [bridge, progressReady, provider, source, step]);

  const loginOfficial = async () => {
    setError("");
    setOfficialBusy(true);
    try {
      const next = await bridge.officialOAuthLogin();
      await persist({ ...next, customModelMode: false });
      const status = await bridge.officialStatus();
      setOfficialLoggedIn(status.loggedIn);
      setOfficialEmail(status.email);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setOfficialBusy(false);
    }
  };

  const continueFromSource = async () => {
    if (!settings || !source) return;
    setError("");
    setBusy(true);
    try {
      if (source === "official") {
        if (!officialLoggedIn) throw new Error("请先登录 SECTL 账号");
        await persist({ ...settings, customModelMode: false });
      } else {
        if (!provider.name.trim() || !provider.baseUrl.trim() || !provider.models.length) {
          throw new Error("请填写提供商信息并至少添加一个模型");
        }
        const providers = settings.providers.some((item) => item.id === provider.id)
          ? settings.providers.map((item) => item.id === provider.id ? provider : item)
          : [...settings.providers.filter((item) => item.id !== "sectl-official"), provider, ...settings.providers.filter((item) => item.id === "sectl-official")];
        await persist({ ...settings, customModelMode: true, providers });
      }
      await saveProgress({ step: "plugins", source, ...(source === "custom" ? { provider } : {}) });
      goToStep("plugins");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    setError("");
    setBusy(true);
    try {
      await bridge.completeOnboarding();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setBusy(false);
    }
  };

  const installPlugin = async (plugin: MarketplacePlugin | undefined): Promise<boolean> => {
    if (!plugin) {
      setError("市场暂无兼容的 SecAgent 侧插件");
      return false;
    }
    const version = latestCompatibleVersion(plugin, bridge.platform);
    if (!version) {
      setError(`市场暂无兼容的 ${plugin.name} SecAgent 侧插件`);
      return false;
    }
    const companionPending = plugin.id === "classisland-connector"
      ? classIslandTargets.some((target) => classIslandSelectedIds.includes(target.id) && !isClassIslandTargetReady(target))
      : plugin.id === "secrandom"
        ? secRandomTargets.some((target) => secRandomSelectedIds.includes(target.id) && !isSecRandomTargetReady(target))
        : plugin.id === "iccce-connector"
          ? iccceTargets.some((target) => iccceSelectedIds.includes(target.id) && !isIccceTargetReady(target))
          : plugin.id === "class-widgets"
            ? cwTargets.some((target) => cwSelectedIds.includes(target.id) && !isClassWidgetsTargetReady(target))
            : false;
    setInstallingId(plugin.id);
    setCardProgressHold((current) => {
      const next = { ...current };
      delete next[plugin.id];
      return next;
    });
    let saPercent = 5;
    saPercentRef.current[plugin.id] = saPercent;
    setSaProgress((current) => ({ ...current, [plugin.id]: saPercent }));
    const progressTimer = window.setInterval(() => {
      saPercent = Math.min(100, saPercent + 3);
      saPercentRef.current[plugin.id] = saPercent;
      setSaProgress((current) => ({ ...current, [plugin.id]: saPercent }));
    }, 180);
    setError("");
    try {
      setPlugins(await bridge.installMarketplaceVersion(version));
      saPercent = 100;
      saPercentRef.current[plugin.id] = saPercent;
      setSaProgress((current) => ({ ...current, [plugin.id]: saPercent }));
      // When the companion half is still pending, the connector completes the
      // 0-50 half of the card; otherwise it completes the whole bar.
      setCardProgressHold((current) => ({ ...current, [plugin.id]: companionPending ? 50 : 100 }));
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      // Keep the last position on the scale the card was showing.
      const heldPercent = Math.max(5, saPercentRef.current[plugin.id] ?? 5);
      setCardProgressHold((current) => ({ ...current, [plugin.id]: companionPending ? heldPercent / 2 : heldPercent }));
      return false;
    } finally {
      window.clearInterval(progressTimer);
      setInstallingId("");
      setSaProgress((current) => {
        const next = { ...current };
        delete next[plugin.id];
        return next;
      });
    }
  };

  const pickClassIslandExecutable = async () => {
    setError("");
    try {
      const candidate = await bridge.pickClassIslandExecutable();
      if (!candidate) return;
      setClassIslandTargetsExpanded(true);
      setClassIslandTargets((current) => current.some((item) => item.id === candidate.id) ? current.map((item) => item.id === candidate.id ? candidate : item) : [...current, candidate]);
      if (candidate.compatible) setClassIslandSelectedIds((current) => current.includes(candidate.id) ? current : [...current, candidate.id]);
      if (!candidate.compatible) setError(candidate.reason || "选择的 ClassIsland 版本不兼容");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const pickSecRandomExecutable = async () => {
    setError("");
    try {
      const candidate = await bridge.pickSecRandomExecutable();
      if (!candidate) return;
      setSecRandomTargetsExpanded(true);
      setSecRandomTargets((current) => current.some((item) => item.id === candidate.id) ? current.map((item) => item.id === candidate.id ? candidate : item) : [...current, candidate]);
      if (candidate.compatible) setSecRandomSelectedIds((current) => current.includes(candidate.id) ? current : [...current, candidate.id]);
      if (!candidate.compatible) setError(candidate.reason || "选择的 SecRandom 版本不兼容");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const pickIccceExecutable = async () => {
    setError("");
    try {
      const candidate = await bridge.pickIccceExecutable();
      if (!candidate) return;
      setIccceTargetsExpanded(true);
      setIccceTargets((current) => current.some((item) => item.id === candidate.id) ? current.map((item) => item.id === candidate.id ? candidate : item) : [...current, candidate]);
      if (candidate.compatible) setIccceSelectedIds((current) => current.includes(candidate.id) ? current : [...current, candidate.id]);
      if (!candidate.compatible) setError(candidate.reason || "选择的 ICC-CE 版本不兼容");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const pickClassWidgetsExecutable = async () => {
    setError("");
    try {
      const candidate = await bridge.pickClassWidgetsExecutable();
      if (!candidate) return;
      setCwTargetsExpanded(true);
      setCwTargets((current) => current.some((item) => item.id === candidate.id) ? current.map((item) => item.id === candidate.id ? candidate : item) : [...current, candidate]);
      if (candidate.compatible) setCwSelectedIds((current) => current.includes(candidate.id) ? current : [...current, candidate.id]);
      if (!candidate.compatible) setError(candidate.reason || "选择的 Class Widgets 版本不兼容");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const refreshCompanionTargets = async () => {
    try {
      const [classIsland, secRandom, iccce, cw] = await Promise.all([
        bridge.detectClassIslandInstallations(),
        bridge.detectSecRandomInstallations(),
        bridge.detectIccceInstallations(),
        bridge.detectClassWidgetsInstallations()
      ]);
      const merge = <T extends { id: string }>(current: T[], refreshed: T[]): T[] => {
        if (!refreshed.length) return current;
        const currentById = new Map(current.map((target) => [target.id, target]));
        return refreshed.map((target) => currentById.get(target.id) ? { ...currentById.get(target.id), ...target } : target);
      };
      setClassIslandTargets((current) => merge(current, classIsland));
      setSecRandomTargets((current) => merge(current, secRandom));
      setIccceTargets((current) => merge(current, iccce));
      setCwTargets((current) => merge(current, cw));
    } catch {
      // The installation result is still useful if a companion is in the
      // middle of its own shutdown/startup transition.
    }
  };

  const installClassIslandPlugin = async (_market: MarketplacePlugin | undefined): Promise<boolean> => {
    const selectedTargets = classIslandTargets.filter((target) => classIslandSelectedIds.includes(target.id));
    if (!selectedTargets.length) {
      setError("请先选择一个或多个 ClassIsland 安装目标");
      return false;
    }
    if (selectedTargets.some((target) => !target.compatible)) {
      setError("所选 ClassIsland 版本低于 2.0.0.0，无法安装联动插件");
      return false;
    }
    // Holds land on the 50-100 half of the card when the SecAgent connector
    // half is already in place.
    const saHalfInstalled = plugins.some((plugin) => plugin.id === "classisland-connector");
    const holdValue = () => {
      const percent = Math.max(10, companionPercentRef.current["classisland-connector"] ?? 10);
      return saHalfInstalled ? 50 + percent / 2 : percent;
    };
    setInstallingId("classisland-connector:companion");
    setClassIslandPhase("downloading");
    setClassIslandProgressPercent(10);
    setCompanionHighWater((current) => ({ ...current, "classisland-connector": 10 }));
    companionPercentRef.current["classisland-connector"] = 10;
    setCardProgressHold((current) => {
      const next = { ...current };
      delete next["classisland-connector"];
      return next;
    });
    setError("");
    try {
      const results = await bridge.installClassIslandCompanion(selectedTargets.map((target) => target.id));
      setClassIslandResults((current) => ({ ...current, ...Object.fromEntries(results.map((result) => [result.targetId, result])) }));
      setClassIslandTargets((current) => current.map((target) => {
        const result = results.find((item) => item.targetId === target.id);
        return result?.ok && result.version ? { ...target, installedPluginVersion: result.version } : target;
      }));
      await refreshCompanionTargets();
      const failures = results.filter((result) => !result.ok);
      if (failures.length) {
        setCardProgressHold((current) => ({ ...current, "classisland-connector": holdValue() }));
        setError(failures.map((result) => result.message).join("；"));
      } else {
        setCardProgressHold((current) => ({ ...current, "classisland-connector": 100 }));
      }
      return failures.length === 0;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setCardProgressHold((current) => ({ ...current, "classisland-connector": holdValue() }));
      return false;
    } finally {
      setInstallingId("");
      setClassIslandPhase("idle");
      setClassIslandProgressPercent(0);
    }
  };

  const installSecRandomPlugin = async (_market: MarketplacePlugin | undefined): Promise<boolean> => {
    const selectedTargets = secRandomTargets.filter((target) => secRandomSelectedIds.includes(target.id));
    if (!selectedTargets.length) {
      setError("请先选择一个或多个 SecRandom 安装目标");
      return false;
    }
    if (selectedTargets.some((target) => !target.compatible)) {
      setError("所选 SecRandom 版本低于 3.0.0-alpha.1，无法安装联动插件");
      return false;
    }
    const saHalfInstalled = plugins.some((plugin) => plugin.id === "secrandom");
    const holdValue = () => {
      const percent = Math.max(10, companionPercentRef.current["secrandom"] ?? 10);
      return saHalfInstalled ? 50 + percent / 2 : percent;
    };
    setInstallingId("secrandom:companion");
    setSecRandomPhase("downloading");
    setSecRandomProgressPercent(10);
    setCompanionHighWater((current) => ({ ...current, "secrandom": 10 }));
    companionPercentRef.current["secrandom"] = 10;
    setCardProgressHold((current) => {
      const next = { ...current };
      delete next["secrandom"];
      return next;
    });
    setError("");
    try {
      const results = await bridge.installSecRandomCompanion(selectedTargets.map((target) => target.id));
      setSecRandomResults((current) => ({ ...current, ...Object.fromEntries(results.map((result) => [result.targetId, result])) }));
      setSecRandomTargets((current) => current.map((target) => {
        const result = results.find((item) => item.targetId === target.id);
        return result?.ok && result.version ? { ...target, installedPluginVersion: result.version } : target;
      }));
      await refreshCompanionTargets();
      const failures = results.filter((result) => !result.ok);
      if (failures.length) {
        setCardProgressHold((current) => ({ ...current, "secrandom": holdValue() }));
        setError(failures.map((result) => result.message).join("；"));
      } else {
        setCardProgressHold((current) => ({ ...current, "secrandom": 100 }));
      }
      return failures.length === 0;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setCardProgressHold((current) => ({ ...current, "secrandom": holdValue() }));
      return false;
    } finally {
      setInstallingId("");
      setSecRandomPhase("idle");
      setSecRandomProgressPercent(0);
    }
  };

  const installIcccePlugin = async (_market: MarketplacePlugin | undefined): Promise<boolean> => {
    const selectedTargets = iccceTargets.filter((target) => iccceSelectedIds.includes(target.id));
    if (!selectedTargets.length) {
      setError("请先选择一个或多个 ICC-CE 安装目标");
      return false;
    }
    if (selectedTargets.some((target) => !target.compatible)) {
      setError("所选 ICC-CE 安装目标不兼容");
      return false;
    }
    const saHalfInstalled = plugins.some((plugin) => plugin.id === "iccce-connector");
    const holdValue = () => {
      const percent = Math.max(10, companionPercentRef.current["iccce-connector"] ?? 10);
      return saHalfInstalled ? 50 + percent / 2 : percent;
    };
    setInstallingId("iccce-connector:companion");
    setIcccePhase("downloading");
    setIccceProgressPercent(10);
    setCompanionHighWater((current) => ({ ...current, "iccce-connector": 10 }));
    companionPercentRef.current["iccce-connector"] = 10;
    setCardProgressHold((current) => {
      const next = { ...current };
      delete next["iccce-connector"];
      return next;
    });
    setError("");
    try {
      const results = await bridge.installIccceCompanion(selectedTargets.map((target) => target.id));
      setIccceResults((current) => ({ ...current, ...Object.fromEntries(results.map((result) => [result.targetId, result])) }));
      setIccceTargets((current) => current.map((target) => {
        const result = results.find((item) => item.targetId === target.id);
        return result?.ok && result.version ? { ...target, installedPluginVersion: result.version } : target;
      }));
      await refreshCompanionTargets();
      const failures = results.filter((result) => !result.ok);
      if (failures.length) {
        setCardProgressHold((current) => ({ ...current, "iccce-connector": holdValue() }));
        setError(failures.map((result) => result.message).join("；"));
      } else {
        setCardProgressHold((current) => ({ ...current, "iccce-connector": 100 }));
      }
      return failures.length === 0;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setCardProgressHold((current) => ({ ...current, "iccce-connector": holdValue() }));
      return false;
    } finally {
      setInstallingId("");
      setIcccePhase("idle");
      setIccceProgressPercent(0);
    }
  };

  const installClassWidgetsPlugin = async (_market: MarketplacePlugin | undefined): Promise<boolean> => {
    const selectedTargets = cwTargets.filter((target) => cwSelectedIds.includes(target.id));
    if (!selectedTargets.length) {
      setError("请先选择一个或多个 Class Widgets 安装目标");
      return false;
    }
    if (selectedTargets.some((target) => !target.compatible)) {
      setError("所选 Class Widgets 版本低于 2.0.0.0，无法安装联动插件");
      return false;
    }
    const saHalfInstalled = plugins.some((plugin) => plugin.id === "class-widgets");
    const holdValue = () => {
      const percent = Math.max(10, companionPercentRef.current["class-widgets"] ?? 10);
      return saHalfInstalled ? 50 + percent / 2 : percent;
    };
    setInstallingId("class-widgets:companion");
    setCwPhase("downloading");
    setCwProgressPercent(10);
    setCompanionHighWater((current) => ({ ...current, "class-widgets": 10 }));
    companionPercentRef.current["class-widgets"] = 10;
    setCardProgressHold((current) => {
      const next = { ...current };
      delete next["class-widgets"];
      return next;
    });
    setError("");
    try {
      const results = await bridge.installClassWidgetsCompanion(selectedTargets.map((target) => target.id));
      setCwResults((current) => ({ ...current, ...Object.fromEntries(results.map((result) => [result.targetId, result])) }));
      setCwTargets((current) => current.map((target) => {
        const result = results.find((item) => item.targetId === target.id);
        return result?.ok && result.version ? { ...target, installedPluginVersion: result.version } : target;
      }));
      await refreshCompanionTargets();
      const failures = results.filter((result) => !result.ok);
      if (failures.length) {
        setCardProgressHold((current) => ({ ...current, "class-widgets": holdValue() }));
        setError(failures.map((result) => result.message).join("；"));
      } else {
        setCardProgressHold((current) => ({ ...current, "class-widgets": 100 }));
      }
      return failures.length === 0;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setCardProgressHold((current) => ({ ...current, "class-widgets": holdValue() }));
      return false;
    } finally {
      setInstallingId("");
      setCwPhase("idle");
      setCwProgressPercent(0);
    }
  };

  const installAllPlugins = async () => {
    if (!companionDetectionReady || installingId || allDetectedCompanionsInstalled) return;
    setError("");
    const tasks: Array<() => Promise<void>> = [];
    const batchTargets: { classIsland?: string[]; secRandom?: string[]; iccce?: string[]; cw?: string[] } = {};
    const batchSecAgentTargets: Record<string, boolean> = {};
    const classIslandMarket = marketPlugins.find((plugin) => plugin.id === "classisland-connector");
    const secRandomMarket = marketPlugins.find((plugin) => plugin.id === "secrandom");
    const iccceMarket = marketPlugins.find((plugin) => plugin.id === "iccce-connector");
    const cwMarket = marketPlugins.find((plugin) => plugin.id === "class-widgets");
    const selectedClassIslandTargets = classIslandTargets.filter((target) => classIslandSelectedIds.includes(target.id));
    const selectedSecRandomTargets = secRandomTargets.filter((target) => secRandomSelectedIds.includes(target.id));
    const selectedIccceTargets = iccceTargets.filter((target) => iccceSelectedIds.includes(target.id));
    const selectedCwTargets = cwTargets.filter((target) => cwSelectedIds.includes(target.id));
    const classIslandCompanionInstalled = selectedClassIslandTargets.length > 0 && selectedClassIslandTargets.every(isClassIslandTargetReady);
    const secRandomCompanionInstalled = selectedSecRandomTargets.length > 0 && selectedSecRandomTargets.every(isSecRandomTargetReady);
    const iccceCompanionInstalled = selectedIccceTargets.length > 0 && selectedIccceTargets.every(isIccceTargetReady);
    const cwCompanionInstalled = selectedCwTargets.length > 0 && selectedCwTargets.every(isClassWidgetsTargetReady);
    const installSpecial = (app: DetectedCompanionApp | undefined, pluginId: string, market: MarketplacePlugin | undefined, targetIds: string[], companionInstalled: boolean) => {
      if (!app?.detected && !targetIds.length) return;
      if (!plugins.some((plugin) => plugin.id === pluginId)) batchSecAgentTargets[pluginId] = true;
      tasks.push(async () => {
        let connectorReady = plugins.some((plugin) => plugin.id === pluginId);
        if (!connectorReady) connectorReady = await installPlugin(market);
        if (connectorReady && targetIds.length && !companionInstalled) {
          if (pluginId === "classisland-connector") batchTargets.classIsland = targetIds;
          if (pluginId === "secrandom") batchTargets.secRandom = targetIds;
          if (pluginId === "iccce-connector") batchTargets.iccce = targetIds;
          if (pluginId === "class-widgets") batchTargets.cw = targetIds;
        }
      });
    };
    installSpecial(apps.find((app) => app.pluginId === "classisland-connector"), "classisland-connector", classIslandMarket, classIslandSelectedIds, classIslandCompanionInstalled);
    installSpecial(apps.find((app) => app.pluginId === "secrandom"), "secrandom", secRandomMarket, secRandomSelectedIds, secRandomCompanionInstalled);
    installSpecial(apps.find((app) => app.pluginId === "iccce-connector"), "iccce-connector", iccceMarket, iccceSelectedIds, iccceCompanionInstalled);
    installSpecial(apps.find((app) => app.pluginId === "class-widgets"), "class-widgets", cwMarket, cwSelectedIds, cwCompanionInstalled);
    for (const app of apps.filter((item) => item.detected)) {
      if (app.pluginId === "classisland-connector" || app.pluginId === "secrandom" || app.pluginId === "iccce-connector" || app.pluginId === "class-widgets") continue;
      if (plugins.some((plugin) => plugin.id === app.pluginId)) continue;
      batchSecAgentTargets[app.pluginId] = true;
      tasks.push(async () => { await installPlugin(marketPlugins.find((plugin) => plugin.id === app.pluginId)); });
    }
    if (!tasks.length) {
      setError("没有可安装的课堂联动插件，请先选择安装目标或等待检测完成");
      return;
    }
    setBatchSecAgentTargets(batchSecAgentTargets);
    setBatchActive(true);
    try {
      for (const task of tasks) await task();
      if (!Object.values(batchTargets).some((targetIds) => targetIds?.length)) return;
      setInstallingId("companions:batch");
      setBatchCompanionTargets(batchTargets);
      // Seed each companion half so its bar continues from the SecAgent half
      // (50%) instead of snapping back to zero, and reset the monotonic
      // high-water marks for this new session.
      setClassIslandProgressPercent(batchTargets.classIsland ? 10 : 0);
      setSecRandomProgressPercent(batchTargets.secRandom ? 10 : 0);
      setIccceProgressPercent(batchTargets.iccce ? 10 : 0);
      setCwProgressPercent(batchTargets.cw ? 10 : 0);
      setCompanionHighWater((current) => ({
        ...current,
        ...(batchTargets.classIsland ? { "classisland-connector": 10 } : {}),
        ...(batchTargets.secRandom ? { "secrandom": 10 } : {}),
        ...(batchTargets.iccce ? { "iccce-connector": 10 } : {}),
        ...(batchTargets.cw ? { "class-widgets": 10 } : {})
      }));
      setClassIslandPhase(batchTargets.classIsland ? "downloading" : "idle");
      setSecRandomPhase(batchTargets.secRandom ? "downloading" : "idle");
      setIcccePhase(batchTargets.iccce ? "downloading" : "idle");
      setCwPhase(batchTargets.cw ? "downloading" : "idle");
      try {
        const result = await bridge.installAllCompanions(batchTargets);
        const applyResults = <T extends { targetId: string }>(
          results: T[],
          setResults: (value: (current: Record<string, T>) => Record<string, T>) => void
        ) => {
          setResults((current) => ({ ...current, ...Object.fromEntries(results.map((item) => [item.targetId, item])) }));
        };
        applyResults(result.classIsland, setClassIslandResults);
        applyResults(result.secRandom, setSecRandomResults);
        applyResults(result.iccce, setIccceResults);
        applyResults(result.cw, setCwResults);
        setClassIslandTargets((current) => current.map((target) => {
          const item = result.classIsland.find((candidate) => candidate.targetId === target.id);
          return item?.ok && item.version ? { ...target, installedPluginVersion: item.version } : target;
        }));
        setSecRandomTargets((current) => current.map((target) => {
          const item = result.secRandom.find((candidate) => candidate.targetId === target.id);
          return item?.ok && item.version ? { ...target, installedPluginVersion: item.version } : target;
        }));
        setIccceTargets((current) => current.map((target) => {
          const item = result.iccce.find((candidate) => candidate.targetId === target.id);
          return item?.ok && item.version ? { ...target, installedPluginVersion: item.version } : target;
        }));
        setCwTargets((current) => current.map((target) => {
          const item = result.cw.find((candidate) => candidate.targetId === target.id);
          return item?.ok && item.version ? { ...target, installedPluginVersion: item.version } : target;
        }));
        await refreshCompanionTargets();
        const failures = [...result.classIsland, ...result.secRandom, ...result.iccce, ...result.cw].filter((item) => !item.ok);
        if (failures.length) setError(failures.map((item) => item.message).join("；"));
        // Failed cards freeze at the last reported position alongside the
        // failure reasons; completed cards keep the full bar so the card
        // visibly finishes instead of snapping back to zero.
        const holdUpdate: Record<string, number> = {};
        const recordHold = (pluginId: string, results: Array<{ ok: boolean }>) => {
          const percent = Math.max(10, companionPercentRef.current[pluginId] ?? 10);
          // The connector half occupies 0-50 whether it ran in this batch or
          // was already installed before it.
          const saHalfDone = Boolean(batchSecAgentTargets[pluginId]) || plugins.some((plugin) => plugin.id === pluginId);
          holdUpdate[pluginId] = results.some((item) => !item.ok)
            ? (saHalfDone ? 50 + percent / 2 : percent)
            : 100;
        };
        recordHold("classisland-connector", result.classIsland);
        recordHold("secrandom", result.secRandom);
        recordHold("iccce-connector", result.iccce);
        recordHold("class-widgets", result.cw);
        if (Object.keys(holdUpdate).length) setCardProgressHold((current) => ({ ...current, ...holdUpdate }));
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
        const holdUpdate: Record<string, number> = {};
        const batchApps: Array<[string, string[] | undefined]> = [["classisland-connector", batchTargets.classIsland], ["secrandom", batchTargets.secRandom], ["iccce-connector", batchTargets.iccce], ["class-widgets", batchTargets.cw]];
        for (const [pluginId, targetIds] of batchApps) {
          if (!targetIds?.length) continue;
          const percent = Math.max(10, companionPercentRef.current[pluginId] ?? 10);
          const saHalfDone = Boolean(batchSecAgentTargets[pluginId]) || plugins.some((plugin) => plugin.id === pluginId);
          holdUpdate[pluginId] = saHalfDone ? 50 + percent / 2 : percent;
        }
        if (Object.keys(holdUpdate).length) setCardProgressHold((current) => ({ ...current, ...holdUpdate }));
      } finally {
        setInstallingId("");
        setBatchCompanionTargets({});
        setClassIslandPhase("idle");
        setSecRandomPhase("idle");
        setIcccePhase("idle");
        setCwPhase("idle");
      }
    } finally {
      setBatchActive(false);
      setBatchSecAgentTargets({});
    }
  };

  // A dual-end card is only shown when there is real evidence for it: the app
  // was auto-detected, its SecAgent connector is already installed, or an
  // installation target was found/manually picked. Previously the four linkage
  // apps were always listed, so e.g. Class Widgets appeared as "detected" even
  // when it was never installed on the machine.
  const recommended = useMemo(
    () => filterRecommendedCompanionApps(apps, { plugins, classIslandTargets, secRandomTargets, iccceTargets, cwTargets }),
    [apps, classIslandTargets, cwTargets, iccceTargets, plugins, secRandomTargets]
  );
  const allDetectedCompanionsInstalled = useMemo(() => {
    const detectedApps = apps.filter((app) => app.detected);
    if (!detectedApps.length) return false;
    return detectedApps.every((app) => {
      // "All installed" must cover both halves of a linkage: the SecAgent
      // connector and the companion application's plugin. Previously this
      // only checked the companion side, so the button could claim success
      // while the SecAgent side was unavailable.
      if (!plugins.some((plugin) => plugin.id === app.pluginId)) return false;
      if (app.pluginId === "classisland-connector") {
        const targets = classIslandTargets.filter((target) => target.compatible);
        return targets.length > 0 && targets.every(isClassIslandTargetReady);
      }
      if (app.pluginId === "secrandom") {
        const targets = secRandomTargets.filter((target) => target.compatible);
        return targets.length > 0 && targets.every(isSecRandomTargetReady);
      }
      if (app.pluginId === "iccce-connector") {
        const targets = iccceTargets.filter((target) => target.compatible);
        return targets.length > 0 && targets.every(isIccceTargetReady);
      }
      if (app.pluginId === "class-widgets") {
        const targets = cwTargets.filter((target) => target.compatible);
        return targets.length > 0 && targets.every(isClassWidgetsTargetReady);
      }
      return true;
    });
  }, [apps, classIslandTargets, iccceTargets, cwTargets, plugins, secRandomTargets]);

  if (!settings || !progressReady) return <main className="settings-shell oobe-shell has-window-title"><p>正在读取配置…</p></main>;

  return <main className={`settings-shell oobe-shell has-window-title ${introPhase === "intro" ? "oobe-intro-active" : ""} ${bridge.platform === "darwin" ? "macos-settings" : ""} ${bridge.platform !== "darwin" ? "windows-settings" : ""}`}>
    <div className={`settings-window-title oobe-window-title ${introPhase === "intro" ? "oobe-window-title-intro" : introPhase === "transition" ? "oobe-window-title-transition" : "oobe-window-title-ready"}`}>欢迎使用 SecAgent</div>
    {introPhase !== "complete" && <section className={`oobe-splash ${introPhase === "transition" ? "oobe-splash-exit" : ""}`} aria-label="SecAgent 欢迎页">
      <img className="oobe-splash-icon" src="/icon.svg" alt="SecAgent" />
      <button className="oobe-splash-start" type="button" aria-label="开始配置 SecAgent" onClick={beginIntro}><ArrowRight aria-hidden="true" size={30} strokeWidth={1.8} /></button>
    </section>}
    <div className={`oobe-content ${introPhase === "intro" ? "oobe-content-hidden" : introPhase === "transition" ? "oobe-content-intro-enter" : "oobe-content-ready"}`}>
    <div className={`oobe-page ${pageTransition === "exit" ? "oobe-page-exit" : pageTransition === "enter" ? "oobe-page-enter" : ""} oobe-page-${pageDirection} ${step === "plugins" ? "oobe-page-plugins" : ""} ${pluginsReveal ? "oobe-plugins-reveal" : ""}`}>
    <header className="oobe-header">
      <div className="oobe-progress" role="progressbar" aria-label="OOBE 步骤进度" aria-valuemin={1} aria-valuemax={OOBE_STEP_ORDER.length} aria-valuenow={OOBE_STEP_ORDER.indexOf(step) + 1}>
        {OOBE_STEP_ORDER.map((item, index) => <span className={`oobe-progress-segment ${index <= OOBE_STEP_ORDER.indexOf(step) ? "is-active" : ""}`} key={item} />)}
      </div>
      <p className="oobe-step-label">第 {step === "source" ? "1" : step === "config" ? "2" : "3"} / 3 步</p>
      {step === "plugins" ? <div className="oobe-plugin-heading"><h1>安装课堂联动插件</h1><button className="secondary-button oobe-install-all-button" type="button" disabled={!companionDetectionReady || Boolean(installingId) || busy || allDetectedCompanionsInstalled || recommended.length === 0} onClick={() => void installAllPlugins()}>{!companionDetectionReady ? "检测本机应用中…" : allDetectedCompanionsInstalled ? <><Check aria-hidden="true" size={16} strokeWidth={2.5} />已安装所有</> : "一键安装所有"}</button></div> : <h1>{step === "source" ? "选择模型服务" : "配置模型服务"}</h1>}
      {step !== "plugins" && <p>{step === "source"
        ? "先选择使用 SECTL 官方模型服务，还是接入自己的模型提供商。"
        : step === "config"
          ? "完成模型服务的登录或接口配置，之后即可开始使用 SecAgent。"
          : ""}</p>}
    </header>
    {error && <div className="settings-error">{error}</div>}

    {step === "source" && <>
      <div className="oobe-choice-grid">
        <button type="button" className="oobe-choice" onClick={() => void chooseSource("official")}>
          <span className="oobe-choice-copy"><strong>登录官方服务</strong><span>使用 SECTL 账号使用官方模型，不必自己准备 API Key。默认关闭自定义模型模式。</span></span>
          <span className="oobe-choice-arrow" aria-hidden="true"><ArrowRight size={22} strokeWidth={2} /></span>
        </button>
        <button type="button" className="oobe-choice" onClick={() => void chooseSource("custom")}>
          <span className="oobe-choice-copy"><strong>设置自定义模型提供商</strong><span>接入 OpenAI 兼容、Anthropic、Gemini 等自备供应商，并开启自定义模型模式。</span></span>
          <span className="oobe-choice-arrow" aria-hidden="true"><ArrowRight size={22} strokeWidth={2} /></span>
        </button>
      </div>

    </>}

    {step === "config" && <>
      {source === "official" && <article className="settings-card oobe-panel">
        <p>{officialLoggedIn ? `已登录 ${officialEmail || "SECTL 账号"}。继续后将使用官方模型服务。` : "将打开浏览器登录 SECTL。登录完成后会自动返回，并使用官方模型服务。"}</p>
        {!officialLoggedIn && <button className="primary-button" type="button" disabled={officialBusy} onClick={() => void loginOfficial()}>{officialBusy ? "等待浏览器授权…" : "打开浏览器登录 SECTL"}</button>}
      </article>}

      {source === "custom" && <article className="settings-card oobe-panel">
        <div className="form-grid">
          <label>提供商名称<input value={provider.name} onChange={(event) => updateProvider({ name: event.target.value })} /></label>
          <label>预设<PresetCombobox value={provider.preset || "custom"} presets={presets} onSelect={applyPreset} /></label>
          <label>协议<SelectCombobox ariaLabel="协议" value={provider.provider} options={[{ value: "openai-compatible", label: "OpenAI Chat 兼容" }, { value: "openai-responses", label: "OpenAI Responses" }, { value: "anthropic", label: "Anthropic" }, { value: "google", label: "Google Gemini" }]} onChange={(protocol) => updateProvider({ provider: protocol as ProviderConfig["provider"] })} /></label>
          <label className="wide-field">Base URL<input value={provider.baseUrl} onChange={(event) => updateProvider({ baseUrl: event.target.value })} /></label>
          <label>Endpoint<input value={provider.endpoint || ""} onChange={(event) => updateProvider({ endpoint: event.target.value })} /></label>
          <label>API Key<input type="password" placeholder={provider.apiKeyConfigured ? "已配置（留空保持不变）" : "粘贴 API Key"} value={provider.apiKey || ""} onChange={(event) => updateProvider({ apiKey: event.target.value })} /></label>
        </div>
        <div className="provider-model-editor">
          <div className="card-heading">
            <strong>模型列表</strong>
            <div className="oobe-model-add">
              <input value={newModelId} placeholder="模型 ID" onChange={(event) => setNewModelId(event.target.value)} />
              <button type="button" className="secondary-button" onClick={() => {
                const id = newModelId.trim();
                if (!id || provider.models.some((model) => model.id === id)) return;
                updateProvider({ models: [...provider.models, { id, name: id, enabled: true }] });
                setNewModelId("");
              }}>+ 添加模型</button>
            </div>
          </div>
          {provider.models.map((model, index) => <div className="provider-model-row" key={`${model.id}-${index}`}>
            <input value={model.name || ""} onChange={(event) => updateProvider({ models: provider.models.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item) })} />
            <code>{model.id}</code>
            <button type="button" className="text-button danger" onClick={() => updateProvider({ models: provider.models.filter((_, itemIndex) => itemIndex !== index) })}>删除</button>
          </div>)}
          {!provider.models.length && <p className="empty-list">至少添加一个模型 ID 才能继续。</p>}
        </div>
      </article>}

      <div className="oobe-actions">
        <button className="secondary-button" type="button" onClick={() => void saveProgress({ step: "source" }).then(() => { setSource(null); goToStep("source"); }).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))}>上一步</button>
        <button className="primary-button" type="button" disabled={!source || busy || (source === "official" && !officialLoggedIn)} onClick={() => void continueFromSource()}>{busy ? "保存中…" : "下一步"}</button>
      </div>
    </>}

    {step === "plugins" && <>
      {marketError && <div className="settings-error">{marketError}</div>}
      {!companionDetectionReady ? <div className="oobe-plugin-detection-loading" role="status" aria-live="polite">
        <span className="oobe-plugin-detection-spinner" aria-hidden="true" />
        <span className="visually-hidden">正在检测本机课堂软件…</span>
      </div> : <section className="oobe-plugin-list">
        <h2>本机已检测到</h2>
        {!recommended.length && <div className="oobe-plugin-empty">
          <p className="empty-list">没有自动检测到已适配的课堂应用。安装对应应用后会自动出现在这里；若已安装但未被识别，可手动选择其可执行文件。</p>
          <div className="oobe-plugin-manual-picks">
            <button className="secondary-button" type="button" onClick={() => void pickClassIslandExecutable()}>选择 ClassIsland.exe</button>
            <button className="secondary-button" type="button" onClick={() => void pickClassWidgetsExecutable()}>选择 Class Widgets 可执行文件</button>
            <button className="secondary-button" type="button" onClick={() => void pickSecRandomExecutable()}>选择 SecRandom 可执行文件</button>
            <button className="secondary-button" type="button" onClick={() => void pickIccceExecutable()}>选择 ICC-CE 可执行文件</button>
          </div>
        </div>}
        {recommended.map((app, index) => <OobePluginCard key={app.pluginId} app={app} index={index} marketPlugins={marketPlugins} plugins={plugins} platform={bridge.platform} installingId={installingId} batchActive={batchActive} batchCompanionTargets={batchCompanionTargets} batchSecAgentTargets={batchSecAgentTargets} saProgress={saProgress} companionHighWater={companionHighWater} cardProgressHold={cardProgressHold} classIslandTargets={classIslandTargets} secRandomTargets={secRandomTargets} iccceTargets={iccceTargets} cwTargets={cwTargets} classIslandSelectedIds={classIslandSelectedIds} secRandomSelectedIds={secRandomSelectedIds} iccceSelectedIds={iccceSelectedIds} cwSelectedIds={cwSelectedIds} setClassIslandSelectedIds={setClassIslandSelectedIds} setSecRandomSelectedIds={setSecRandomSelectedIds} setIccceSelectedIds={setIccceSelectedIds} setCwSelectedIds={setCwSelectedIds} classIslandTargetsExpanded={classIslandTargetsExpanded} secRandomTargetsExpanded={secRandomTargetsExpanded} iccceTargetsExpanded={iccceTargetsExpanded} cwTargetsExpanded={cwTargetsExpanded} setClassIslandTargetsExpanded={setClassIslandTargetsExpanded} setSecRandomTargetsExpanded={setSecRandomTargetsExpanded} setIccceTargetsExpanded={setIccceTargetsExpanded} setCwTargetsExpanded={setCwTargetsExpanded} classIslandResults={classIslandResults} secRandomResults={secRandomResults} iccceResults={iccceResults} cwResults={cwResults} classIslandPhase={classIslandPhase} secRandomPhase={secRandomPhase} icccePhase={icccePhase} cwPhase={cwPhase} classIslandProgressPercent={classIslandProgressPercent} secRandomProgressPercent={secRandomProgressPercent} iccceProgressPercent={iccceProgressPercent} cwProgressPercent={cwProgressPercent} installPlugin={installPlugin} installClassIslandPlugin={installClassIslandPlugin} installSecRandomPlugin={installSecRandomPlugin} installIcccePlugin={installIcccePlugin} installClassWidgetsPlugin={installClassWidgetsPlugin} pickClassIslandExecutable={pickClassIslandExecutable} pickSecRandomExecutable={pickSecRandomExecutable} pickIccceExecutable={pickIccceExecutable} pickClassWidgetsExecutable={pickClassWidgetsExecutable} />)}
      </section>}
      <div className="oobe-actions">
        <button className="secondary-button" type="button" onClick={() => void saveProgress({ step: "config", source: source || undefined, ...(source === "custom" ? { provider } : {}) }).then(() => goToStep("config")).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))}>上一步</button>
        <button className="secondary-button" type="button" disabled={busy} onClick={() => void finish()}>暂时跳过</button>
        <button className="primary-button" type="button" disabled={busy} onClick={() => void finish()}>{busy ? "完成中…" : "完成并开始使用"}</button>
      </div>
    </>}
    </div>
    </div>
  </main>;
}
