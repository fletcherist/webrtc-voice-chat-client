import * as React from "react";
import { useRef, useState, useEffect } from "react";

import css from "./VoiceChat.module.css";

function sample<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

const getMediaStreamVolume = (
  mediaStream: MediaStream,
  callback: (volume: number) => void
) => {
  window.AudioContext =
    window.AudioContext || (window as any).webkitAudioContext;
  const audioContext = new AudioContext();
  const analyser = audioContext.createAnalyser();
  const mediaStreamSource = audioContext.createMediaStreamSource(mediaStream);
  const processor = audioContext.createScriptProcessor(512);

  analyser.smoothingTimeConstant = 0.8;
  analyser.fftSize = 1024;

  mediaStreamSource.connect(analyser);
  analyser.connect(processor);
  processor.connect(audioContext.destination);
  processor.onaudioprocess = function (event) {
    const buf = event.inputBuffer.getChannelData(0);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const x = buf[i];
      sum += x * x;
    }
    const rms = Math.sqrt(sum / buf.length);
    callback(rms);
  };
};

class MediaStreamManager {
  public audioContext: AudioContext;
  public gainMaster: GainNode;

  private mediaStreamDestination: MediaStreamAudioDestinationNode;

  private microphone: MediaStreamAudioSourceNode | undefined;
  private microphoneGain: GainNode | undefined;

  private oscillator: OscillatorNode;
  private oscillatorGain: GainNode;

  constructor() {
    const AudioContext =
      window.AudioContext || (window as any).webkitAudioContext;

    this.audioContext = new AudioContext();

    this.oscillator = this.audioContext.createOscillator();
    this.oscillatorGain = this.audioContext.createGain();
    this.disableOscillator();

    this.gainMaster = this.audioContext.createGain();

    this.oscillator.connect(this.oscillatorGain);
    this.oscillatorGain.connect(this.gainMaster);

    this.oscillator.detune.value = 100;
    this.oscillator.frequency.value = sample([
      200,
      250,
      300,
      350,
      400,
      450,
      500,
      550,
    ]);

    this.oscillator.start(0);

    this.mediaStreamDestination = this.audioContext.createMediaStreamDestination();
    this.gainMaster.connect(this.mediaStreamDestination);

    this.gainMaster.gain.value = 1;
  }

  public getStream(): MediaStream {
    return this.mediaStreamDestination.stream;
  }

  public async requestMicrophone(): Promise<void> {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });

      this.microphone = this.audioContext.createMediaStreamSource(mediaStream);
      this.microphoneGain = this.audioContext.createGain();
      this.microphone.connect(this.microphoneGain);
      this.microphoneGain.connect(this.gainMaster);
    } catch (error) {
      return undefined;
    }
  }

  mute() {
    this.gainMaster.gain.value = 0;
  }
  unmute() {
    this.gainMaster.gain.value = 1;
  }

  get isMuted() {
    return this.gainMaster.gain.value === 0;
  }

  microphoneMute() {
    if (!this.microphoneGain) {
      throw new Error("Microphone is not connected");
    }
    this.microphoneGain.gain.value = 0;
  }
  microphoneUnmute() {
    if (!this.microphoneGain) {
      throw new Error("Microphone is not connected");
    }
    this.microphoneGain.gain.value = 1;
  }

  enableOscillator() {
    this.oscillatorGain.gain.value = 1;
  }
  disableOscillator() {
    this.oscillatorGain.gain.value = 0;
  }
}

interface Transport {
  sendOffer: (sessionDescription: RTCSessionDescriptionInit) => void;
  sendAnswer: (sessionDescription: RTCSessionDescriptionInit) => void;
  sendCandidate: (candidate: RTCIceCandidateInit) => void;

  onOpen: (callback: () => void) => void;
  onOffer: (
    callback: (sessionDescription: RTCSessionDescriptionInit) => void
  ) => void;
  onAnswer: (
    callback: (sessionDescription: RTCSessionDescriptionInit) => void
  ) => void;
  onCandidate: (callback: (candidate: RTCIceCandidateInit) => void) => void;
}

interface TransportEvent {
  type: "offer" | "answer" | "candidate" | "error" | "request_offer";

  offer?: RTCSessionDescriptionInit;
  answer?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}

class WebSocketTransport implements Transport {
  private ws: WebSocket;
  private onOfferCallback: (
    sessionDescription: RTCSessionDescriptionInit
  ) => void;
  private onAnswerCallback: (
    sessionDescription: RTCSessionDescriptionInit
  ) => void;
  private onCandidateCallback: (candidate: RTCIceCandidateInit) => void;
  private onOpenCallback: () => void;
  constructor(path: string) {
    this.onOfferCallback = () => undefined;
    this.onAnswerCallback = () => undefined;
    this.onCandidateCallback = () => undefined;
    this.onOpenCallback = () => undefined;
    this.ws = new WebSocket(path);
    this.ws.addEventListener("message", (event) => this.onMessage(event));
    this.ws.addEventListener("open", () => this.onOpenCallback());
    this.ws.addEventListener("close", () => console.log("ws is closed"));
    this.ws.addEventListener("error", (error) => console.error(error));
  }
  public sendOffer(sessionDescription: RTCSessionDescriptionInit): void {
    this.sendJSON({ type: "offer", offer: sessionDescription });
  }
  public sendAnswer(sessionDescription: RTCSessionDescriptionInit): void {
    this.sendJSON({ type: "answer", answer: sessionDescription });
  }
  public sendCandidate(candidate: RTCIceCandidateInit) {
    this.sendJSON({ type: "candidate", candidate });
  }
  public requestOffer() {
    this.sendJSON({ type: "request_offer" });
  }

  private sendJSON(event: TransportEvent) {
    this.ws.send(JSON.stringify(event));
  }

  private onMessage(event: MessageEvent) {
    const data = JSON.parse(event.data) as TransportEvent;
    if (data.type === "answer" && data.answer) {
      return this.onAnswerCallback(data.answer);
    } else if (data.type === "offer" && data.offer) {
      return this.onOfferCallback(data.offer);
    } else if (data.type === "candidate" && data.candidate) {
      return this.onCandidateCallback(data.candidate);
    } else if (data.type === "error") {
      console.error(data);
    } else {
      throw new Error(`type ${data.type} not implemented`);
    }
  }

  public onOpen(callback: () => void): void {
    this.onOpenCallback = callback;
  }
  public onOffer(callback: WebSocketTransport["onOfferCallback"]): void {
    this.onOfferCallback = callback;
  }
  public onAnswer(callback: WebSocketTransport["onAnswerCallback"]): void {
    this.onAnswerCallback = callback;
  }
  public onCandidate(
    callback: WebSocketTransport["onCandidateCallback"]
  ): void {
    this.onCandidateCallback = callback;
  }
}

const usePeerConnection = ({
  transport,
}: {
  transport: Transport;
}): RTCPeerConnection => {
  const refPeerConnection = useRef<RTCPeerConnection>(
    new RTCPeerConnection({
      iceServers: [
        {
          urls: "stun:stun.l.google.com:19302",
        },
      ],
    })
  );
  const peerConnection = refPeerConnection.current;
  const { current: state } = useRef<{
    isSendingOffer: boolean;
  }>({
    isSendingOffer: false,
  });

  useEffect(() => {
    const handleTrack = async (event: RTCTrackEvent) => {
      console.log(event);
      console.log(`peerConnection::ontrack ${event.track.kind}`);
      console.log(event.track.kind, event.streams);
      const stream = event.streams[0];
      try {
        // if (refAudioEl.current) {
        //   refAudioEl.current.srcObject = stream;
        //   refAudioEl.current.autoplay = true;
        //   refAudioEl.current.controls = true;
        //   await refAudioEl.current.play();
        // }
        const audioEl = document.createElement("audio");
        console.log("attached speaker volume");
        audioEl.srcObject = stream;
        audioEl.autoplay = true;
        audioEl.controls = true;
        document.querySelector("#tracks")?.appendChild(audioEl);
        await audioEl.play();
      } catch (error) {
        console.log(error);
      }
    };
    const handleConnectionStateChange = (event: Event) => {
      console.log(
        `peerConnection::onIceConnectionStateChange ${peerConnection.iceConnectionState}`
      );
    };
    const handleICECandidate = (event: RTCPeerConnectionIceEvent) => {
      if (event.candidate) {
        transport.sendCandidate(event.candidate.toJSON());
      }
    };

    const handleNegotiationNeeded = async (event: Event) => {
      // console.log("peerConnection::negotiationneeded", event);
      // await peerConnection.setLocalDescription(
      //   await peerConnection.createOffer()
      // );
      // if (!peerConnection.localDescription) {
      //   throw new Error("no local description");
      // }
      // transport.sendOffer(peerConnection.localDescription);
    };

    peerConnection.addEventListener("track", handleTrack);
    peerConnection.addEventListener(
      "iceconnectionstatechange",
      handleConnectionStateChange
    );

    peerConnection.addEventListener(
      "negotiationneeded",
      handleNegotiationNeeded
    );
    peerConnection.addEventListener("icecandidate", handleICECandidate);

    return () => {
      peerConnection.removeEventListener("track", handleTrack);
      peerConnection.removeEventListener(
        "connectionstatechange",
        handleConnectionStateChange
      );
      peerConnection.removeEventListener("icecandidate", handleICECandidate);
      peerConnection.removeEventListener(
        "negotiationneeded",
        handleNegotiationNeeded
      );
    };
  }, []);

  return refPeerConnection.current;
};

const DEFAULT_MIC_ENABLED = false;

const Conference = () => {
  const [micEnabled, setMicEnabled] = useState<boolean>(DEFAULT_MIC_ENABLED);
  const [microphoneVolume, setMicrophoneVolume] = useState<number>(0);
  const [speakerVolume, setSpeakerVolume] = useState<number>(0);

  const refMediaStreamManager = useRef<MediaStreamManager>(
    new MediaStreamManager()
  );
  const refAudioEl = useRef<HTMLMediaElement | null>(null);
  // const refAudioElBach = useRef<HTMLMediaElement | null>(null);
  const refWebSocket = useRef<WebSocketTransport>();

  const { current: transport } = useRef<WebSocketTransport>(
    new WebSocketTransport(
      `wss://cap.chat/${window.location.pathname.replace("/", "")}`
    )
  );

  const peerConnection = usePeerConnection({ transport });

  const log = (msg: any) => {
    console.log(msg);
  };

  const subscribe = async () => {
    try {
      // Create a noop DataChannel. By default PeerConnections do not connect
      // if they have no media tracks or DataChannels
      const mediaStream = refMediaStreamManager.current.getStream();
      const audioTracks = mediaStream.getAudioTracks();
      for (const track of audioTracks) {
        peerConnection.addTrack(track, mediaStream);
      }
    } catch (error) {
      log(error);
    }
  };

  useEffect(() => {
    transport.onOpen(() => {
      console.log("web socket connection is open");
      subscribe();
      transport.requestOffer();
    });
    transport.onOffer(async (offer) => {
      await peerConnection.setRemoteDescription(offer);
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      transport.sendAnswer(answer);
    });
    transport.onAnswer(async (answer) => {
      await peerConnection.setRemoteDescription(answer);
    });
    transport.onCandidate(async (candidate) => {
      console.log("[local]: adding ice candidate");
      await peerConnection.addIceCandidate(candidate);
    });

    // ws.addEventListener("open", handleOpen);
    // ws.addEventListener("close", handleClose);
    // ws.addEventListener("message", handleMessage);
    // ws.addEventListener("error", handleError);
    return () => {
      // ws.removeEventListener("open", handleOpen);
      // ws.removeEventListener("close", handleClose);
      // ws.removeEventListener("message", handleMessage);
      // ws.removeEventListener("error", handleError);
    };
  }, []);

  useEffect(() => {
    const handleUnmuteMicrophone = (event: KeyboardEvent) => {
      try {
        if (event.key === "Shift") {
          if (refMediaStreamManager.current) {
            refMediaStreamManager.current.microphoneUnmute();
            setMicEnabled(true);
          }
        }
      } catch (error) {
        log(error);
      }
    };
    const handleMuteMicrophone = (event: KeyboardEvent) => {
      try {
        if (event.key === "Shift") {
          if (refMediaStreamManager.current) {
            refMediaStreamManager.current.microphoneUnmute();
            setMicEnabled(false);
          }
        }
      } catch (error) {
        log(error);
      }
    };
    window.addEventListener("keydown", handleUnmuteMicrophone);
    window.addEventListener("keyup", handleMuteMicrophone);
    return () => {
      window.removeEventListener("keydown", handleUnmuteMicrophone);
      window.removeEventListener("keyup", handleMuteMicrophone);
    };
  }, []);
  return (
    <div>
      <audio ref={refAudioEl} controls />
      <div>
        <button
          onClick={async () => {
            if (refMediaStreamManager.current) {
              await refMediaStreamManager.current.requestMicrophone();
              setMicEnabled(true);
            }
          }}
        >
          Request microphone
          <span role="img" aria-label="enable microphone">
            🎤
          </span>
        </button>
      </div>
      <div>
        <button
          onClick={() => {
            if (refMediaStreamManager.current) {
              if (refMediaStreamManager.current.isMuted) {
                refMediaStreamManager.current.unmute();
                setMicEnabled(true);
              } else {
                refMediaStreamManager.current.mute();
                setMicEnabled(false);
              }
            }
          }}
        >
          {micEnabled ? "mute" : "enable"} microphone
          <span role="img" aria-label="enable microphone">
            🎤
          </span>
        </button>
      </div>
      <div>microphone: {micEnabled ? "enabled" : "disabled"}</div>
      <div>microphone volume:{String(microphoneVolume)}</div>
      <div>speaker volume: {speakerVolume}</div>

      {/* <div>
        <button
          onClick={() => {
            console.log("streaming bach");
            if (refAudioElBach.current && refMediaStreamManager.current) {
              const mediaElementSource = refMediaStreamManager.current.audioContext.createMediaElementSource(
                refAudioElBach.current
              );
              const gainMedia = refMediaStreamManager.current.audioContext.createGain();
              mediaElementSource.connect(gainMedia);
              gainMedia.gain.value = 0.05;
              gainMedia.connect(refMediaStreamManager.current.gainMaster);
              refAudioElBach.current.play();
            }
          }}
        >
          stream j.s bach
        </button>
      </div> */}
      {/* <div>
        <button
          onClick={async () => {
            console.log("adding track");
            // if (refMediaStreamManager.current) {
            // const stream = refMediaStreamManager.current.getStream()
            const stream = await navigator.mediaDevices.getUserMedia({
              audio: true
            });
            peerConnection.addTrack(stream.getAudioTracks()[0], stream);
            // }
          }}
        >
          add track dynamically
        </button>
      </div> */}
      {/* <audio
        ref={refAudioElBach}
        controls
        src="https://www.thesoundarchive.com/starwars/star-wars-cantina-song.mp3"
      /> */}

      <h1>tracks</h1>
      <div id="tracks"></div>
      <div className={css.container}>
        <div
          className={css.speakButton}
          onPointerDown={() => {
            // setMicEnabled(true);
            if (refMediaStreamManager.current) {
              // subscribe();
              refMediaStreamManager.current.enableOscillator();
            }
          }}
          onPointerUp={() => {
            // setMicEnabled(false);
            if (refMediaStreamManager.current) {
              refMediaStreamManager.current.disableOscillator();
            }
          }}
        />
      </div>
    </div>
  );
};

export const VoiceChat = () => {
  const [showConference, setShowConference] = useState<boolean>(false);

  const renderContent = () => {
    if (!showConference) {
      return (
        <div
          style={{
            height: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <button
            onClick={() => {
              setShowConference(true);
            }}
            style={{
              fontSize: 48,
            }}
          >
            tap to join voice chat
          </button>
        </div>
      );
    }

    return <Conference />;
  };
  return <div>{renderContent()}</div>;
};
