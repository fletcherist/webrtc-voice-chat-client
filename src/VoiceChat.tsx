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

  public isMicrophoneRequested: boolean;

  constructor() {
    this.isMicrophoneRequested = false;

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
      this.isMicrophoneRequested = true;
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });

      this.microphone = this.audioContext.createMediaStreamSource(mediaStream);
      this.microphoneGain = this.audioContext.createGain();
      this.microphoneGain.gain.value = 0; // mute by default
      this.microphone.connect(this.microphoneGain);
      this.microphoneGain.connect(this.gainMaster);
    } catch (error) {
      this.isMicrophoneRequested = false;
      return undefined;
    }
  }

  mute() {
    this.gainMaster.gain.value = 0;
  }
  unmute() {
    this.gainMaster.gain.value = 1;
  }

  get isMicrophoneMuted(): boolean {
    if (!this.microphoneGain) {
      throw new Error("Microphone is not connected");
    }
    return this.microphoneGain.gain.value === 0;
  }

  microphoneMute(): void {
    if (!this.microphoneGain) {
      throw new Error("Microphone is not connected");
    }
    this.microphoneGain.gain.value = 0;
  }
  microphoneUnmute(): void {
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
  type:
    | "offer"
    | "answer"
    | "candidate"
    | "error"
    | "request_offer"
    | "user"
    | "user_join"
    | "user_leave"
    | "room";

  offer?: RTCSessionDescriptionInit;
  answer?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  user?: User;
  room?: Room;
}
interface User {
  id: string;
  emoji: string;
}

interface Room {
  users: User[];
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
  private onEventCallback: (event: TransportEvent) => void;
  constructor(path: string) {
    this.onOfferCallback = () => undefined;
    this.onAnswerCallback = () => undefined;
    this.onCandidateCallback = () => undefined;
    this.onOpenCallback = () => undefined;
    this.onEventCallback = () => undefined;
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
      this.onEventCallback(data);
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
  public onEvent(callback: WebSocketTransport["onEventCallback"]): void {
    this.onEventCallback = callback;
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

interface State {
  isMutedMicrophone: boolean;
  isMutedSpeaker: boolean;
  user?: User;
  room: Room;
}

interface Api {
  roomUserAdd: (user: User) => void;
  roomUserRemove: (user: User) => void;
}
interface Store {
  state: State;
  update: (partial: Partial<State>) => void;
  api: Api;
}
const defaultState: State = {
  isMutedMicrophone: true,
  isMutedSpeaker: false,
  room: {
    users: [],
  },
};

const StoreContext = React.createContext<Store | undefined>(undefined);
const StoreProvider: React.FC = ({ children }) => {
  const [state, setState] = useState<State>(defaultState);
  const update = (partial: Partial<State>) =>
    setState({ ...state, ...partial });

  const api: Api = {
    roomUserAdd: (user) => {
      update({
        room: {
          ...state.room,
          users: [...state.room.users, user],
        },
      });
    },
    roomUserRemove: (user) => {
      update({
        room: {
          ...state.room,
          users: state.room.users.filter((roomUser) => roomUser.id !== user.id),
        },
      });
    },
  };
  return (
    <StoreContext.Provider
      value={{
        state,
        update,
        api,
      }}
    >
      {children}
    </StoreContext.Provider>
  );
};
const useStore = (): Store => {
  const context = React.useContext(StoreContext);
  return context as Store; // store is defined anyway
};

const DEFAULT_MIC_ENABLED = false;

const Conference = () => {
  const [micEnabled, setMicEnabled] = useState<boolean>(DEFAULT_MIC_ENABLED);
  const [microphoneVolume, setMicrophoneVolume] = useState<number>(0);
  const [speakerVolume, setSpeakerVolume] = useState<number>(0);

  const refMediaStreamManager = useRef<MediaStreamManager>(
    new MediaStreamManager()
  );
  // const refAudioElBach = useRef<HTMLMediaElement | null>(null);
  const store = useStore();
  const { state, update } = store;

  const [user, setUser] = useState<User>();
  const refTransport = useRef<WebSocketTransport>();
  if (!refTransport.current) {
    refTransport.current = new WebSocketTransport(
      `wss://cap.chat/${window.location.pathname.replace("/", "")}`
    );
  }
  const transport = refTransport.current;
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
    console.log("store", store);
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
    transport.onEvent(async (event) => {
      console.log("EVENT", event);

      if (event.type === "user_join") {
        if (!event.user) {
          throw new Error("no user");
        }
        store.api.roomUserAdd(event.user);
      } else if (event.type === "user_leave") {
        if (!event.user) {
          throw new Error("no user");
        }
        store.api.roomUserRemove(event.user);
      } else if (event.type === "user") {
        setUser(event.user);
      } else if (event.type === "room") {
        store.update({ room: event.room });
      } else {
        throw new Error(`type ${event.type} not implemented`);
      }
    });
  }, [store]);

  // useEffect(() => {
  //   const handleUnmuteMicrophone = (event: KeyboardEvent) => {
  //     try {
  //       if (event.key === "Shift") {
  //         if (refMediaStreamManager.current) {
  //           refMediaStreamManager.current.microphoneUnmute();
  //           setMicEnabled(true);
  //         }
  //       }
  //     } catch (error) {
  //       log(error);
  //     }
  //   };
  //   const handleMuteMicrophone = (event: KeyboardEvent) => {
  //     try {
  //       if (event.key === "Shift") {
  //         if (refMediaStreamManager.current) {
  //           refMediaStreamManager.current.microphoneUnmute();
  //           setMicEnabled(false);
  //         }
  //       }
  //     } catch (error) {
  //       log(error);
  //     }
  //   };
  //   window.addEventListener("keydown", handleUnmuteMicrophone);
  //   window.addEventListener("keyup", handleMuteMicrophone);
  //   return () => {
  //     window.removeEventListener("keydown", handleUnmuteMicrophone);
  //     window.removeEventListener("keyup", handleMuteMicrophone);
  //   };
  // }, []);

  const renderUsers = () => {
    if (state.room.users.length === 0) {
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            height: "100%",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 60,
            }}
          >
            👀
          </div>
          <div style={{ textAlign: "center", fontSize: 16, color: "white" }}>
            ждём остальных...
          </div>
        </div>
      );
    }
    return store.state.room.users.map((user) => {
      return (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            pointerEvents: "none",
            userSelect: "none",
            padding: 20,
          }}
          key={user.id}
        >
          <div style={{ fontSize: 48 }}>{user.emoji}</div>
        </div>
      );
    });
  };
  const renderUser = () => {
    if (!user) {
      return null;
    }
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          pointerEvents: "none",
          userSelect: "none",
        }}
      >
        <div style={{ fontSize: 96 }}>{user.emoji}</div>
      </div>
    );
  };
  return (
    <div className={css.wrapper}>
      {/* <div id="tracks"></div> */}

      {/* <div>microphone volume:{String(microphoneVolume)}</div>
      <div>speaker volume: {speakerVolume}</div> */}

      <div className={css.top}>{renderUsers()}</div>
      <div className={css.bottom}>
        {renderUser()}
        <div className={css.buttons}>
          <ButtonMicrohone
            muted={state.isMutedMicrophone}
            onClick={async () => {
              if (refMediaStreamManager.current) {
                if (!refMediaStreamManager.current.isMicrophoneRequested) {
                  await refMediaStreamManager.current.requestMicrophone();
                }
                if (refMediaStreamManager.current.isMicrophoneMuted) {
                  refMediaStreamManager.current.microphoneUnmute();
                  update({ isMutedMicrophone: false });
                } else {
                  refMediaStreamManager.current.microphoneMute();
                  update({ isMutedMicrophone: true });
                }
              }
            }}
          />
          <ButtonSpeaker
            muted={state.isMutedSpeaker}
            onClick={() => update({ isMutedSpeaker: !state.isMutedSpeaker })}
          />
        </div>
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
            className={css.buttonJoin}
          >
            войти 📞
          </button>
        </div>
      );
    }
    return <Conference />;
  };

  return (
    <StoreProvider>
      <div className={css.container}>
        {/* <Sandbox /> */}
        {renderContent()}
      </div>
    </StoreProvider>
  );
};

const Sandbox = () => {
  return <div>{/* <Buttons /> */}</div>;
};

const ButtonMicrohoneContainer = () => {
  const [isMuted, setIsMuted] = useState<boolean>(false);
  return (
    <ButtonMicrohone muted={isMuted} onClick={() => setIsMuted(!isMuted)} />
  );
};

const ButtonSpeakerContainer = () => {
  const [isMuted, setIsMuted] = useState<boolean>(false);
  return <ButtonSpeaker muted={isMuted} onClick={() => setIsMuted(!isMuted)} />;
};

const ButtonMicrohone: React.FC<{
  muted: boolean;
  onClick: (event: React.MouseEvent) => void;
}> = ({ onClick, muted }) => {
  return (
    <button className={css.buttonMicrophone} onClick={onClick}>
      <IconMicrophone muted={muted} />
    </button>
  );
};

const ButtonSpeaker: React.FC<{
  muted: boolean;
  onClick: (event: React.MouseEvent) => void;
}> = ({ onClick, muted }) => {
  return (
    <button className={css.buttonMicrophone} onClick={onClick}>
      <IconSpeaker muted={muted} />
    </button>
  );
};

const IconMicrophone: React.FC<{
  muted: boolean;
}> = ({ muted }) => {
  if (muted) {
    return (
      <svg aria-hidden="false" width="100%" height="100%" viewBox="0 0 24 24">
        <path
          d="M6.7 11H5C5 12.19 5.34 13.3 5.9 14.28L7.13 13.05C6.86 12.43 6.7 11.74 6.7 11Z"
          fill="white"
        ></path>
        <path
          d="M9.01 11.085C9.015 11.1125 9.02 11.14 9.02 11.17L15 5.18V5C15 3.34 13.66 2 12 2C10.34 2 9 3.34 9 5V11C9 11.03 9.005 11.0575 9.01 11.085Z"
          fill="white"
        ></path>
        <path
          d="M11.7237 16.0927L10.9632 16.8531L10.2533 17.5688C10.4978 17.633 10.747 17.6839 11 17.72V22H13V17.72C16.28 17.23 19 14.41 19 11H17.3C17.3 14 14.76 16.1 12 16.1C11.9076 16.1 11.8155 16.0975 11.7237 16.0927Z"
          fill="white"
        ></path>
        <path
          d="M21 4.27L19.73 3L3 19.73L4.27 21L8.46 16.82L9.69 15.58L11.35 13.92L14.99 10.28L21 4.27Z"
          fill="#f04747"
        ></path>
      </svg>
    );
  }

  return (
    <svg aria-hidden="false" width="100%" height="100%" viewBox="0 0 24 24">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M14.99 11C14.99 12.66 13.66 14 12 14C10.34 14 9 12.66 9 11V5C9 3.34 10.34 2 12 2C13.66 2 15 3.34 15 5L14.99 11ZM12 16.1C14.76 16.1 17.3 14 17.3 11H19C19 14.42 16.28 17.24 13 17.72V21H11V17.72C7.72 17.23 5 14.41 5 11H6.7C6.7 14 9.24 16.1 12 16.1ZM12 4C11.2 4 11 4.66667 11 5V11C11 11.3333 11.2 12 12 12C12.8 12 13 11.3333 13 11V5C13 4.66667 12.8 4 12 4Z"
        fill="white"
      ></path>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M14.99 11C14.99 12.66 13.66 14 12 14C10.34 14 9 12.66 9 11V5C9 3.34 10.34 2 12 2C13.66 2 15 3.34 15 5L14.99 11ZM12 16.1C14.76 16.1 17.3 14 17.3 11H19C19 14.42 16.28 17.24 13 17.72V22H11V17.72C7.72 17.23 5 14.41 5 11H6.7C6.7 14 9.24 16.1 12 16.1Z"
        fill="white"
      ></path>
    </svg>
  );
};

const IconSpeaker: React.FC<{
  muted: boolean;
}> = ({ muted }) => {
  if (muted) {
    return (
      <svg aria-hidden="false" width="100%" height="100%" viewBox="0 0 24 24">
        <path
          d="M6.16204 15.0065C6.10859 15.0022 6.05455 15 6 15H4V12C4 7.588 7.589 4 12 4C13.4809 4 14.8691 4.40439 16.0599 5.10859L17.5102 3.65835C15.9292 2.61064 14.0346 2 12 2C6.486 2 2 6.485 2 12V19.1685L6.16204 15.0065Z"
          fill="white"
        ></path>
        <path
          d="M19.725 9.91686C19.9043 10.5813 20 11.2796 20 12V15H18C16.896 15 16 15.896 16 17V20C16 21.104 16.896 22 18 22H20C21.105 22 22 21.104 22 20V12C22 10.7075 21.7536 9.47149 21.3053 8.33658L19.725 9.91686Z"
          fill="white"
        ></path>
        {muted && (
          <path
            d="M3.20101 23.6243L1.7868 22.2101L21.5858 2.41113L23 3.82535L3.20101 23.6243Z"
            fill="#f04747"
          ></path>
        )}
      </svg>
    );
  }

  return (
    <svg aria-hidden="false" width="100%" height="100%" viewBox="0 0 24 24">
      <svg width="24" height="24" viewBox="0 0 24 24">
        <path
          d="M12 2.00305C6.486 2.00305 2 6.48805 2 12.0031V20.0031C2 21.1071 2.895 22.0031 4 22.0031H6C7.104 22.0031 8 21.1071 8 20.0031V17.0031C8 15.8991 7.104 15.0031 6 15.0031H4V12.0031C4 7.59105 7.589 4.00305 12 4.00305C16.411 4.00305 20 7.59105 20 12.0031V15.0031H18C16.896 15.0031 16 15.8991 16 17.0031V20.0031C16 21.1071 16.896 22.0031 18 22.0031H20C21.104 22.0031 22 21.1071 22 20.0031V12.0031C22 6.48805 17.514 2.00305 12 2.00305Z"
          fill="white"
        ></path>
      </svg>
    </svg>
  );
};

const Trash = () => {
  return (
    <div>
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
      {/* <div>
        <button onClick={() => {}}>
          {micEnabled ? "mute" : "enable"} microphone
          <span role="img" aria-label="enable microphone">
            🎤
          </span>
        </button>
      </div>
      <div>microphone: {micEnabled ? "enabled" : "disabled"}</div> */}
      {/* <div
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
        /> */}
    </div>
  );
};
