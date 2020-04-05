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
  processor.onaudioprocess = function(event) {
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
      550
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
        audio: true
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

const useWebSocket = (): {
  connect: (url: string) => Promise<void>;
  io: WebSocket | undefined;
} => {
  const refWebSocket = useRef<WebSocket>();

  const defaultConnectUrl = `wss://cap.chat/${window.location.pathname.replace(
    "/",
    ""
  )}`;
  return {
    connect: (url: string = defaultConnectUrl): Promise<void> => {
      return new Promise((resolve, reject) => {
        refWebSocket.current = new WebSocket(url);
        refWebSocket.current.addEventListener("open", () => resolve());
        refWebSocket.current.addEventListener("error", () => reject());
        return;
      });
    },
    io: refWebSocket.current
  };
};

const usePeerConnection = ({
  transport
}: {
  transport: {
    sendOffer: (sessionDescription: RTCSessionDescription) => Promise<void>;
  };
}): RTCPeerConnection => {
  const refPeerConnection = useRef<RTCPeerConnection>(
    new RTCPeerConnection({
      iceServers: [
        {
          urls: "stun:stun.l.google.com:19302"
        }
      ]
    })
  );
  const peerConnection = refPeerConnection.current;

  useEffect(() => {
    const handleTrack = async (event: RTCTrackEvent) => {
      console.log(event);
      console.log(`peerConnection::ontrack ${event.track.kind}`);
      console.log(event.track.kind, event.streams);
      const stream = event.streams[0];

      const audioEl = document.createElement("audio");

      console.log("attached speaker volume");
      try {
        // if (refAudioEl.current) {
        //   refAudioEl.current.srcObject = stream;
        //   refAudioEl.current.autoplay = true;
        //   refAudioEl.current.controls = true;
        //   await refAudioEl.current.play();
        // }
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
    const handleICECandidate = (event: RTCPeerConnectionIceEvent) => {};

    peerConnection.addEventListener("track", handleTrack);
    peerConnection.addEventListener(
      "iceconnectionstatechange",
      handleConnectionStateChange
    );

    peerConnection.addEventListener("negotiationneeded", async event => {
      console.log("peerConnection::negotiationneeded", event);

      console.log(0);
      await peerConnection.setLocalDescription(
        await peerConnection.createOffer()
      );
      console.log(1);
      if (!peerConnection.localDescription) {
        throw new Error("no local description");
      }
      transport.sendOffer(peerConnection.localDescription);
      console.log(2);
    });

    return () => {
      peerConnection.removeEventListener("track", handleTrack);
      peerConnection.removeEventListener(
        "connectionstatechange",
        handleConnectionStateChange
      );
      peerConnection.removeEventListener("icecandidate", handleICECandidate);
    };
  }, []);

  return refPeerConnection.current;
};

const DEFAULT_MIC_ENABLED = false;
export const VoiceChat = () => {
  const refStream = useRef<MediaStream | undefined>(undefined);
  const [micEnabled, setMicEnabled] = useState<boolean>(DEFAULT_MIC_ENABLED);
  const [microphoneVolume, setMicrophoneVolume] = useState<number>(0);
  const [speakerVolume, setSpeakerVolume] = useState<number>(0);

  const refMediaStreamManager = useRef<MediaStreamManager>();
  const refAudioEl = useRef<HTMLMediaElement | null>(null);
  const refAudioElBach = useRef<HTMLMediaElement | null>(null);
  const refWebSocket = useRef<WebSocket>();

  const transport = {
    sendOffer: async (sessionDescription: RTCSessionDescription) => {
      if (!refWebSocket.current) {
        throw new Error("transport is not ready");
      }
      refWebSocket.current.send(
        JSON.stringify({
          type: "offer",
          offer: sessionDescription
        })
      );
    }
  };

  const peerConnection = usePeerConnection({ transport });

  const log = (msg: any) => {
    console.log(msg);
    const logs = document.getElementById("logs");
    if (logs) {
      logs.innerHTML += msg + "<br>";
    }
  };

  const subscribe = async () => {
    try {
      if (!refMediaStreamManager.current) {
        refMediaStreamManager.current = new MediaStreamManager();
      }

      const createOffer = async (): Promise<void> => {
        if (!refMediaStreamManager.current) {
          throw new Error("no refMediaStreamManager");
        }
        const mediaStream = refMediaStreamManager.current.getStream();

        const audioTracks = mediaStream.getAudioTracks();
        for (const track of audioTracks) {
          peerConnection.addTrack(track);
        }
        log("peerConnection::createOffer");

        log("peerConnection::createOffer_created");
        await peerConnection.setLocalDescription(
          await peerConnection.createOffer()
        );
      };

      await createOffer();
    } catch (error) {
      log(error);
    }
  };

  useEffect(() => {
    const ws = new WebSocket(
      `wss://cap.chat/${window.location.pathname.replace("/", "")}`
    );
    refWebSocket.current = ws;
    const handleOpen = () => {
      console.log("web socket connection is open");
    };
    const handleClose = () => {
      console.log("web socket connection is closed");
    };
    const handleMessage = async (event: MessageEvent) => {
      try {
        interface VoiceChatEvent {
          type: "offer" | "answer";

          offer?: RTCSessionDescription;
          answer?: RTCSessionDescription;
        }
        const data = JSON.parse(event.data) as VoiceChatEvent;
        if (data.type === "answer" && data.answer) {
          await peerConnection.setRemoteDescription(
            new RTCSessionDescription(data.answer)
          );
        } else if (data.type === "offer" && data.offer) {
          await peerConnection.setRemoteDescription(
            new RTCSessionDescription(data.offer)
          );
          const answer = await peerConnection.createAnswer();
          await peerConnection.setLocalDescription(answer);
          refWebSocket.current?.send(
            JSON.stringify({
              type: "answer",
              answer: answer
            })
          );
        }
      } catch (error) {
        console.error(error);
      }
    };
    const handleError = (event: Event) => {
      console.log("ws error", event);
    };
    ws.addEventListener("open", handleOpen);
    ws.addEventListener("close", handleClose);
    ws.addEventListener("message", handleMessage);
    ws.addEventListener("error", handleError);
    return () => {
      ws.removeEventListener("open", handleOpen);
      ws.removeEventListener("close", handleClose);
      ws.removeEventListener("message", handleMessage);
      ws.removeEventListener("error", handleError);
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
          onClick={() => {
            subscribe();
          }}
        >
          join
        </button>
      </div>
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

      <div>
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
      </div>
      <div>
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
      </div>
      <audio
        ref={refAudioElBach}
        controls
        src="https://www.thesoundarchive.com/starwars/star-wars-cantina-song.mp3"
      />

      <h1>tracks</h1>
      <div id="tracks"></div>

      <div>
        <b>logs</b>
        <br />
        <div id="logs" />
        <br />
        <br />
      </div>
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
