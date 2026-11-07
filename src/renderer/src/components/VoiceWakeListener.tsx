import { useEffect } from "react";

/** Invisible microphone capture window used while voice wake is enabled. */
export function VoiceWakeListener() {
  useEffect(() => {
    let context: AudioContext | undefined;
    let stream: MediaStream | undefined;
    let source: MediaStreamAudioSourceNode | undefined;
    let workletNode: AudioWorkletNode | undefined;
    let stopped = false;
    const phrase = new URLSearchParams(window.location.search).get("phrase") || "小泽同学";
    let audioFrames = 0;
    let lastHeartbeatAt = 0;
    const log = (stage: string, data: Record<string, unknown> = {}) => {
      const payload = { stage, ...data };
      console.info("[voice-wake] renderer", payload);
      window.secagent.logVoiceWake(payload);
    };
    /* R74：ScriptProcessorNode（已废弃 API、跑渲染主线程）→ AudioWorklet
       （独立实时音频线程）。用户实测「喊不动」在高负载/大屏场景集中爆发：
       1×1 隐藏窗的渲染进程被 Chromium 降优先级节流后 onaudioprocess 掉帧，
       KWS 前端特征序列断流，等效失聪。worklet 线程不受渲染节流影响。
       每 2048 样本（128ms）聚合一批再 postMessage，保持主进程 feed 节奏。 */
    const WORKLET_SRC = `class WakeCaptureProcessor extends AudioWorkletProcessor {
  constructor() { super(); this._buf = new Float32Array(2048); this._n = 0; }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    for (let i = 0; i < channel.length; i++) {
      this._buf[this._n++] = channel[i];
      if (this._n >= this._buf.length) { this.port.postMessage(this._buf); this._buf = new Float32Array(2048); this._n = 0; }
    }
    return true;
  }
}
registerProcessor("wake-capture", WakeCaptureProcessor);`;
    const removeResume = window.secagent.onVoiceWakeResume(() => {
      void (async () => {
        log("resume.received", { contextState: context?.state || "uninitialized", liveTracks: stream?.getAudioTracks().filter((track) => track.readyState === "live").length || 0 });
        try {
          await window.secagent.startVoiceWake(phrase);
          if (context && context.state !== "running") await context.resume();
          log("resume.completed", { contextState: context?.state || "uninitialized" });
        } catch (error) {
          log("resume.failed", { error: error instanceof Error ? error.message : String(error) });
        }
      })();
    });
    void (async () => {
      try {
        log("capture.starting", { phrase });
        await window.secagent.startVoiceWake(phrase);
        stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        if (stopped) return;
        context = new AudioContext({ sampleRate: 16000 });
        context.onstatechange = () => log("audio-context.state", { state: context?.state || "closed" });
        if (context.state !== "running") await context.resume();
        const moduleUrl = URL.createObjectURL(new Blob([WORKLET_SRC], { type: "application/javascript" }));
        await context.audioWorklet.addModule(moduleUrl);
        URL.revokeObjectURL(moduleUrl);
        source = context.createMediaStreamSource(stream);
        workletNode = new AudioWorkletNode(context, "wake-capture", { numberOfInputs: 1, numberOfOutputs: 0 });
        workletNode.port.onmessage = (event: MessageEvent<Float32Array>) => {
          audioFrames += 1;
          const now = Date.now();
          if (audioFrames === 1 || now - lastHeartbeatAt >= 15000) {
            lastHeartbeatAt = now;
            log("audio.frames", { count: audioFrames, contextState: context?.state || "closed" });
          }
          window.secagent.sendVoiceWakeAudio(event.data);
        };
        source.connect(workletNode);
        stream.getAudioTracks().forEach((track) => track.addEventListener("ended", () => log("audio-track.ended", { label: track.label })));
        log("capture.ready", { contextState: context.state, tracks: stream.getAudioTracks().length, phrase, capture: "audio-worklet" });
      } catch (error) {
        log("capture.failed", { error: error instanceof Error ? error.message : String(error) });
        await window.secagent.stopVoiceWake();
      }
    })();
    return () => {
      stopped = true;
      log("capture.stopping", { audioFrames, contextState: context?.state || "uninitialized" });
      workletNode?.disconnect();
      source?.disconnect();
      stream?.getTracks().forEach((track) => track.stop());
      void context?.close();
      void window.secagent.stopVoiceWake();
      removeResume();
    };
  }, []);
  return null;
}
