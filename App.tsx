import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  TouchableWithoutFeedback,
  ViewStyle,
  useWindowDimensions,
} from "react-native";
import Svg, { Path, Rect, Ellipse, Circle, Line } from "react-native-svg";
import { useAudioPlayer, setAudioModeAsync } from "expo-audio";

// --- Global Constants ---
const THORN_WIDTH = 80;
const FISH_SIZE = 48;
const FISH_X_POSITION = 60;
const SEABED_HEIGHT = 80;
const SURFACE_HEIGHT = 40;

type Level = "Easy" | "Medium" | "Hard";

interface LevelConfig {
  gravity: number;
  diveStrength: number;
  thornSpeed: number;
  thornSpawnRate: number;
  thornGap: number;
}

const LEVEL_CONFIGS: Record<Level, LevelConfig> = {
  Easy: {
    gravity: -0.18,
    diveStrength: 5.0,
    thornSpeed: 3,
    thornSpawnRate: 1800,
    thornGap: 240,
  },
  Medium: {
    gravity: -0.22,
    diveStrength: 6.0,
    thornSpeed: 4.5,
    thornSpawnRate: 1500,
    thornGap: 180,
  },
  Hard: {
    gravity: -0.32,
    diveStrength: 7.0,
    thornSpeed: 6,
    thornSpawnRate: 1100,
    thornGap: 140,
  },
};

type GameState = "MENU" | "PLAYING" | "GAME_OVER";

interface ThornData {
  x: number;
  topHeight: number;
  passed: boolean;
}

// --- Sound Sources ---
// Preloading the files for use in the audio players
const diveAudioSource = require("./assets/sounds/dive.wav");
const scoreAudioSource = require("./assets/sounds/score.wav");
const crashAudioSource = require("./assets/sounds/crash.wav");

export default function App() {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const size = { width: windowWidth, height: windowHeight };

  const [gameState, setGameState] = useState<GameState>("MENU");
  const [level, setLevel] = useState<Level>("Medium");

  // Game Engine Logic
  const fishPosRef = useRef<number>(windowHeight / 2);
  const fishVelocityRef = useRef<number>(0);
  const thornsRef = useRef<ThornData[]>([]);
  const scoreRef = useRef<number>(0);

  // Timing Refs for Delta Time
  const lastThornSpawnRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const reqIdRef = useRef<number>(0);

  // Force re-renders for the frame loop
  const [, setRenderTick] = useState(0);

  const currentConfig = LEVEL_CONFIGS[level];

  // --- Audio Configuration & Playback (Using expo-audio) ---
  const divePlayer = useAudioPlayer(diveAudioSource);
  const scorePlayer = useAudioPlayer(scoreAudioSource);
  const crashPlayer = useAudioPlayer(crashAudioSource);

  useEffect(() => {
    // Configure audio to play even if the physical switch is on silent (iOS)
    // and correctly handle background volume reduction (ducking)
    setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: "duckOthers",
    }).catch((err) => console.warn("Could not set audio mode:", err));
  }, []);

  const playDiveSound = useCallback(() => {
    if (divePlayer) {
      divePlayer.seekTo(0);
      divePlayer.play();
    }
  }, [divePlayer]);

  const playScoreSound = useCallback(() => {
    if (scorePlayer) {
      scorePlayer.seekTo(0);
      scorePlayer.play();
    }
  }, [scorePlayer]);

  const playCrashSound = useCallback(() => {
    if (crashPlayer) {
      crashPlayer.seekTo(0);
      crashPlayer.play();
    }
  }, [crashPlayer]);

  // --- Unified Game Loop ---
  useEffect(() => {
    if (gameState !== "PLAYING") return;

    const updateLoop = (currentTime: number) => {
      // Initialize timers on the first frame using requestAnimationFrame's currentTime
      if (lastTimeRef.current === 0) {
        lastTimeRef.current = currentTime;
        lastThornSpawnRef.current = currentTime;
      }

      let dt = currentTime - lastTimeRef.current;

      if (dt > 100) dt = 16.66;
      lastTimeRef.current = currentTime;

      const timeScale = dt / 16.66;

      // 1. Apply Physics
      fishVelocityRef.current += currentConfig.gravity * timeScale;
      if (fishVelocityRef.current < -7) {
        fishVelocityRef.current = -7;
      }
      fishPosRef.current += fishVelocityRef.current * timeScale;

      // 2. Move Thorns
      thornsRef.current = thornsRef.current
        .map((thorn) => ({
          ...thorn,
          x: thorn.x - currentConfig.thornSpeed * timeScale,
        }))
        .filter((thorn) => thorn.x + THORN_WIDTH > -20);

      // 3. Spawner
      if (
        currentTime - lastThornSpawnRef.current >=
        currentConfig.thornSpawnRate
      ) {
        const minThornHeight = 60;
        const maxThornHeight =
          size.height -
          SEABED_HEIGHT -
          SURFACE_HEIGHT -
          currentConfig.thornGap -
          minThornHeight;

        const safeMaxHeight = Math.max(minThornHeight, maxThornHeight);
        const randomHeight =
          Math.floor(Math.random() * (safeMaxHeight - minThornHeight + 1)) +
          minThornHeight;

        thornsRef.current.push({
          x: size.width + 50,
          topHeight: randomHeight,
          passed: false,
        });
        lastThornSpawnRef.current = currentTime;
      }

      // 4. Collision Detection
      const hitboxWidth = 24;
      const hitboxHeight = 24;

      const fishLeft = FISH_X_POSITION + (FISH_SIZE - hitboxWidth) / 2;
      const fishRight = fishLeft + hitboxWidth;
      const fishTop = fishPosRef.current + (FISH_SIZE - hitboxHeight) / 2;
      const fishBottom = fishTop + hitboxHeight;

      let isGameOver = false;

      if (
        fishPosRef.current + FISH_SIZE - 10 >= size.height - SEABED_HEIGHT ||
        fishPosRef.current + 10 <= SURFACE_HEIGHT
      ) {
        isGameOver = true;
      }

      thornsRef.current.forEach((thorn) => {
        const inThornHorizontalRange =
          fishRight > thorn.x + 15 && fishLeft < thorn.x + THORN_WIDTH - 15;

        const topThornBottom = SURFACE_HEIGHT + thorn.topHeight;
        const bottomThornTop =
          SURFACE_HEIGHT + thorn.topHeight + currentConfig.thornGap;

        const hitTopThorn = fishTop < topThornBottom;
        const hitBottomThorn = fishBottom > bottomThornTop;

        if (inThornHorizontalRange && (hitTopThorn || hitBottomThorn)) {
          isGameOver = true;
        }

        if (!thorn.passed && thorn.x + THORN_WIDTH < fishLeft) {
          thorn.passed = true;
          scoreRef.current += 1;
          playScoreSound();
        }
      });

      if (isGameOver) {
        playCrashSound();
        setGameState("GAME_OVER");
        return;
      }

      setRenderTick((t) => t + 1);
      reqIdRef.current = requestAnimationFrame(updateLoop);
    };

    reqIdRef.current = requestAnimationFrame(updateLoop);
    return () => cancelAnimationFrame(reqIdRef.current);
  }, [gameState, currentConfig, size, playCrashSound, playScoreSound]);

  // --- Controls ---
  const handleDive = useCallback(() => {
    if (gameState === "PLAYING") {
      playDiveSound();
      fishVelocityRef.current = currentConfig.diveStrength;
    }
  }, [gameState, currentConfig, playDiveSound]);

  const startGame = (selectedLevel: Level) => {
    setLevel(selectedLevel);
    fishPosRef.current = size.height / 2;
    fishVelocityRef.current = 0;
    thornsRef.current = [];
    scoreRef.current = 0;

    // Reset timers to 0 so requestAnimationFrame initializes them properly
    lastThornSpawnRef.current = 0;
    lastTimeRef.current = 0;

    setGameState("PLAYING");
  };

  const returnToMenu = () => {
    setGameState("MENU");
    fishPosRef.current = size.height / 2;
    thornsRef.current = [];
    scoreRef.current = 0;
  };

  const calculateFishRotation = () => {
    if (gameState !== "PLAYING") return Math.sin(Date.now() / 250) * 10;
    const baseRotation = Math.min(
      Math.max(fishVelocityRef.current * 7, -35),
      50,
    );
    const swimWobble = Math.sin(Date.now() / 100) * 6;
    return baseRotation + swimWobble;
  };

  return (
    <TouchableWithoutFeedback onPress={handleDive}>
      <View style={styles.container}>
        {/* Deep Ocean Vector Background */}
        <View style={styles.absoluteFill}>
          <Svg
            viewBox="0 0 100 100"
            width="100%"
            height="100%"
            preserveAspectRatio="none"
          >
            <Rect x="0" y="0" width="100%" height="100%" fill="#020617" />
            <Path
              d="M 0 0 L 100 0 L 100 85 Q 70 80 50 85 T 0 82 Z"
              fill="#082f49"
            />
            <Path
              d="M 0 0 L 100 0 L 100 65 Q 80 70 45 62 T 0 66 Z"
              fill="#075985"
            />
            <Path
              d="M 0 0 L 100 0 L 100 45 Q 60 40 35 48 T 0 43 Z"
              fill="#0369a1"
            />
            <Path
              d="M 0 0 L 100 0 L 100 25 Q 50 30 25 22 T 0 26 Z"
              fill="#0284c7"
            />
          </Svg>
        </View>

        {/* Score Display */}
        {gameState === "PLAYING" && (
          <Text style={styles.scoreDisplay}>{scoreRef.current}</Text>
        )}

        {/* Main Menu UI */}
        {gameState === "MENU" && (
          <View style={styles.overlayContainer}>
            <View style={styles.overlayPanel}>
              <Text style={styles.overlayTitle}>Softy Fish</Text>
              <Text style={styles.overlaySubtitle}>
                Navigate the ocean depths.
              </Text>
              <Text style={styles.instructionText}>Tap to Dive ⬇️</Text>
              <View style={styles.btnGroup}>
                {(Object.keys(LEVEL_CONFIGS) as Level[]).map((lvl) => (
                  <TouchableOpacity
                    key={lvl}
                    style={[
                      styles.btnFriendly,
                      styles[`btn${lvl}` as keyof typeof styles] as ViewStyle,
                    ]}
                    onPress={() => startGame(lvl)}
                  >
                    <Text style={styles.btnText}>{lvl} Waters</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>
        )}

        {/* Game Over UI */}
        {gameState === "GAME_OVER" && (
          <View style={styles.overlayContainer}>
            <View style={styles.overlayPanel}>
              <Text style={styles.overlayTitle}>Out of Breath!</Text>
              <Text style={styles.overlaySubtitle}>
                You navigated {scoreRef.current} obstacles.
              </Text>
              <View style={styles.btnGroup}>
                <TouchableOpacity
                  style={[styles.btnFriendly, styles.btnAction]}
                  onPress={() => startGame(level)}
                >
                  <Text style={styles.btnText}>Dive Again</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btnFriendly, styles.btnMenu]}
                  onPress={returnToMenu}
                >
                  <Text style={styles.btnText}>Main Menu</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}

        {/* The Fish */}
        <View
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: FISH_SIZE,
            height: FISH_SIZE,
            transform: [
              { translateX: FISH_X_POSITION },
              { translateY: fishPosRef.current },
              { rotate: `${calculateFishRotation()}deg` },
            ],
            zIndex: 10,
          }}
        >
          <Svg width="100%" height="100%" viewBox="0 0 100 100">
            <Path
              d="M 45 25 Q 55 5 70 25 Z"
              fill="#0284c7"
              stroke="#0369a1"
              strokeWidth="3"
              strokeLinejoin="round"
            />
            <Path
              d="M 35 50 L -5 25 Q 15 50 -5 75 L 35 50 Z"
              fill="#38bdf8"
              stroke="#0369a1"
              strokeWidth="3"
              strokeLinejoin="round"
            />
            <Ellipse
              cx="55"
              cy="50"
              rx="38"
              ry="24"
              fill="#e0f2fe"
              stroke="#0369a1"
              strokeWidth="4"
            />
            <Path
              d="M 45 55 Q 60 80 75 60 Z"
              fill="#0284c7"
              stroke="#0369a1"
              strokeWidth="3"
              strokeLinejoin="round"
            />
            <Circle
              cx="75"
              cy="42"
              r="7"
              fill="white"
              stroke="#0369a1"
              strokeWidth="2"
            />
            <Circle cx="77" cy="42" r="3.5" fill="#0f172a" />
            <Path
              d="M 82 58 Q 88 60 84 64"
              fill="none"
              stroke="#0369a1"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </Svg>
        </View>

        {/* Obstacles (Thorns) */}
        {thornsRef.current.map((thorn, i) => {
          const bottomThornHeight =
            size.height -
            thorn.topHeight -
            currentConfig.thornGap -
            SURFACE_HEIGHT;

          return (
            <React.Fragment key={i}>
              {/* Top Formation */}
              <View
                style={{
                  position: "absolute",
                  top: SURFACE_HEIGHT,
                  left: 0,
                  width: THORN_WIDTH,
                  height: thorn.topHeight,
                  transform: [{ translateX: thorn.x }],
                  zIndex: 5,
                }}
              >
                <Svg width="100%" height="100%" preserveAspectRatio="none">
                  <Path
                    d={`M 15,-10 L ${THORN_WIDTH - 15},-10 L ${THORN_WIDTH / 2 + 10},${thorn.topHeight - 20} Q ${THORN_WIDTH / 2},${thorn.topHeight} ${THORN_WIDTH / 2 - 10},${thorn.topHeight - 20} Z`}
                    fill="#064e3b"
                    stroke="#022c22"
                    strokeWidth="3"
                    strokeLinejoin="round"
                  />
                  <Line
                    x1={THORN_WIDTH / 2}
                    y1="-10"
                    x2={THORN_WIDTH / 2 - 5}
                    y2={thorn.topHeight - 30}
                    stroke="#022c22"
                    strokeWidth="2"
                    opacity="0.4"
                  />
                  <Line
                    x1={THORN_WIDTH / 2 + 15}
                    y1="-10"
                    x2={THORN_WIDTH / 2 + 5}
                    y2={thorn.topHeight - 50}
                    stroke="#022c22"
                    strokeWidth="2"
                    opacity="0.4"
                  />
                </Svg>
              </View>

              {/* Bottom Formation */}
              <View
                style={{
                  position: "absolute",
                  top:
                    SURFACE_HEIGHT + thorn.topHeight + currentConfig.thornGap,
                  left: 0,
                  width: THORN_WIDTH,
                  height: bottomThornHeight,
                  transform: [{ translateX: thorn.x }],
                  zIndex: 5,
                }}
              >
                <Svg width="100%" height="100%" preserveAspectRatio="none">
                  <Path
                    d={`M 15,${bottomThornHeight + 10} L ${THORN_WIDTH - 15},${bottomThornHeight + 10} L ${THORN_WIDTH / 2 + 10},20 Q ${THORN_WIDTH / 2},0 ${THORN_WIDTH / 2 - 10},20 Z`}
                    fill="#064e3b"
                    stroke="#022c22"
                    strokeWidth="3"
                    strokeLinejoin="round"
                  />
                  <Line
                    x1={THORN_WIDTH / 2}
                    y1={bottomThornHeight + 10}
                    x2={THORN_WIDTH / 2 - 5}
                    y2="30"
                    stroke="#022c22"
                    strokeWidth="2"
                    opacity="0.4"
                  />
                  <Line
                    x1={THORN_WIDTH / 2 + 15}
                    y1={bottomThornHeight + 10}
                    x2={THORN_WIDTH / 2 + 5}
                    y2="50"
                    stroke="#022c22"
                    strokeWidth="2"
                    opacity="0.4"
                  />
                </Svg>
              </View>
            </React.Fragment>
          );
        })}

        {/* Water Surface */}
        <View
          style={{
            position: "absolute",
            top: 0,
            width: "100%",
            height: SURFACE_HEIGHT,
            zIndex: 15,
          }}
        >
          <Svg width="100%" height="100%" preserveAspectRatio="none">
            <Rect
              x="0"
              y="0"
              width="100%"
              height="100%"
              fill="#0ea5e9"
              opacity="0.8"
            />
            <Path
              d="M 0 25 Q 40 45 80 25 T 160 25 T 240 25 T 320 25 T 400 25 T 480 25 T 560 25"
              fill="#38bdf8"
              opacity="0.6"
            />
            <Path
              d="M 0 35 Q 30 15 60 35 T 120 35 T 180 35 T 240 35 T 300 35 T 360 35 T 420 35 T 480 35 T 540 35"
              fill="#bae6fd"
              opacity="0.4"
            />
            <Rect x="0" y="0" width="100%" height="10" fill="#e0f2fe" />
          </Svg>
        </View>

        {/* Seabed */}
        <View
          style={{
            position: "absolute",
            bottom: 0,
            width: "100%",
            height: SEABED_HEIGHT,
            zIndex: 15,
          }}
        >
          <Svg width="100%" height="100%" preserveAspectRatio="none">
            <Rect x="0" y="20" width="100%" height="100%" fill="#0f172a" />
            <Path
              d="M 0 25 Q 40 5 80 25 T 160 25 T 240 25 T 320 25 T 400 25 T 480 25 T 560 25"
              fill="#1e293b"
            />
            <Path
              d="M -20 35 Q 30 10 70 35 T 150 35 T 230 35 T 310 35 T 390 35 T 470 35 T 550 35"
              fill="#334155"
              opacity="0.5"
            />
            <Circle cx="15%" cy="55" r="8" fill="#020617" />
            <Circle cx="65%" cy="70" r="12" fill="#020617" />
            <Circle cx="85%" cy="45" r="6" fill="#020617" />
          </Svg>
        </View>
      </View>
    </TouchableWithoutFeedback>
  );
}

// --- Styles ---
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#020617",
    overflow: "hidden",
  },
  absoluteFill: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 0,
  },
  scoreDisplay: {
    position: "absolute",
    top: "12%",
    width: "100%",
    textAlign: "center",
    fontSize: 64,
    fontWeight: "800",
    color: "rgba(255, 255, 255, 0.9)",
    zIndex: 50,
    textShadowColor: "rgba(0, 0, 0, 0.4)",
    textShadowOffset: { width: 0, height: 4 },
    textShadowRadius: 12,
  },
  overlayContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 100,
  },
  overlayPanel: {
    backgroundColor: "rgba(15, 23, 42, 0.85)",
    paddingVertical: 32,
    paddingHorizontal: 24,
    borderRadius: 24,
    alignItems: "center",
    width: "85%",
    maxWidth: 320,
    borderColor: "rgba(255, 255, 255, 0.1)",
    borderWidth: 1,
    elevation: 10,
  },
  overlayTitle: {
    marginBottom: 8,
    fontSize: 32,
    fontWeight: "800",
    color: "#38bdf8",
    textAlign: "center",
  },
  overlaySubtitle: {
    marginBottom: 24,
    fontSize: 16,
    color: "#cbd5e1",
    fontWeight: "600",
    textAlign: "center",
  },
  instructionText: {
    marginTop: -12,
    marginBottom: 24,
    fontSize: 14,
    color: "#7dd3fc",
    fontWeight: "800",
    backgroundColor: "rgba(2, 132, 199, 0.2)",
    borderColor: "rgba(56, 189, 248, 0.3)",
    borderWidth: 1,
    padding: 8,
    borderRadius: 12,
    overflow: "hidden",
  },
  btnGroup: {
    width: "100%",
    flexDirection: "column",
    gap: 12,
  },
  btnFriendly: {
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 16,
    width: "100%",
    alignItems: "center",
    elevation: 3,
  },
  btnText: {
    fontSize: 18,
    fontWeight: "800",
    color: "white",
  },
  btnEasy: { backgroundColor: "#10b981" },
  btnMedium: { backgroundColor: "#f59e0b" },
  btnHard: { backgroundColor: "#e11d48" },
  btnAction: { backgroundColor: "#0284c7" },
  btnMenu: { backgroundColor: "#475569" },
});
