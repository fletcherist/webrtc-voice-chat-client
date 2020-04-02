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

const DEFAULT_MIC_ENABLED = false;
export const VoiceChat = () => {
  const refStream = useRef<MediaStream | undefined>(undefined);
  const [micEnabled, setMicEnabled] = useState<boolean>(DEFAULT_MIC_ENABLED);
  const [microphoneVolume, setMicrophoneVolume] = useState<number>(0);
  const [speakerVolume, setSpeakerVolume] = useState<number>(0);

  const refMediaStreamManager = useRef<MediaStreamManager>();
  const refAudioEl = useRef<HTMLMediaElement | null>(null);
  const refAudioElBach = useRef<HTMLMediaElement | null>(null);

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

      const peerConnection = new RTCPeerConnection({
        iceServers: [
          {
            urls: "stun:stun.l.google.com:19302"
          }
        ]
      });

      peerConnection.onnegotiationneeded = event => {
        console.log("peerConnection::negotiationneeded", event);
      };

      const mediaStream = refMediaStreamManager.current.getStream();
      const audioTracks = mediaStream.getAudioTracks();
      for (const track of audioTracks) {
        peerConnection.addTrack(track);
      }

      log("peerConnection::createOffer");
      const sessionDescription = await peerConnection.createOffer();
      log("peerConnection::createOffer_created");
      peerConnection.setLocalDescription(sessionDescription);

      peerConnection.oniceconnectionstatechange = event => {
        log(
          `peerConnection::onIceConnectionStateChange ${
            peerConnection.iceConnectionState
          }`
        );
      };

      peerConnection.onicecandidate = async event => {
        log("peerConnection::onIceCandidate");
        if (event.candidate === null) {
          const apiUrl = "https://cap.chat";
          try {
            log("peerConnection::onIceCandidate::sendOfferRequest");
            const res = await fetch(`${apiUrl}/offer`, {
              method: "POST",
              body: JSON.stringify(peerConnection.localDescription)
            });
            const json = await res.json();
            console.log("offer request sent", json);
            log("peerConnection::onIceCandidate::sendOfferRequest::accepted");
            peerConnection.setRemoteDescription(
              new RTCSessionDescription(json)
            );
          } catch (error) {
            console.error(error);
          }
        }
      };

      peerConnection.addEventListener("negotiationneeded", event => {
        console.log("peerConnection::negotiationneeded", event);
      });
      peerConnection.ontrack = async event => {
        log(`peerConnection::ontrack ${event.track.kind}`);
        console.log(event.track.kind);
        const stream = event.streams[0];

        log("attached speaker volume");
        try {
          if (refAudioEl.current) {
            refAudioEl.current.srcObject = stream;
            refAudioEl.current.autoplay = true;
            refAudioEl.current.controls = true;
            await refAudioEl.current.play();
          }
        } catch (error) {
          log(error);
        }
      };
    } catch (error) {
      log(error);
    }
  };

  useEffect(() => {
    const ws = new WebSocket("wss://cap.chat/ws");
    const handleOpen = () => {
      console.log("web socket connection is open");
      setTimeout(() => {
        // ws.send("hello world");
        ws.send(
          JSON.stringify({
            type: "offer",
            offer: {
              sdp: "213123123212132"
            }
          })
        );
      }, 5000);
    };
    const handleClose = () => {
      console.log("web socket connection is closed");
    };
    const handleMessage = (event: MessageEvent) => {
      console.log("web socket message", event.data);
    };
    const handleError = (event: Event) => {
      console.log("ws error", event);
    };
    ws.addEventListener("open", handleOpen);
    ws.addEventListener("close", handleClose);
    ws.addEventListener("message", handleMessage);
    ws.addEventListener("error", handleError);

    return () => {
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
      <audio
        ref={refAudioElBach}
        controls
        src="https://www.thesoundarchive.com/starwars/star-wars-cantina-song.mp3"
      />

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
