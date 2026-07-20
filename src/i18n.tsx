import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { RANK_LABELS, type CardRank, type HandType, type SkillType } from "./game";

export type Locale = "ja" | "en";

const STORAGE_KEY = "poker-duel-locale";

const ja = {
  "language.label": "言語",
  "language.japanese": "日本語",
  "language.english": "英語",
  "top.liveLocal": "ローカル対戦",
  "top.cpuMode": "CPUモード",
  "top.chooseMode": "モード選択",
  "top.lanOnline": "LANオンライン",
  "top.soundOn": "音を出す",
  "top.soundOff": "音を消す",
  "fighter.you": "あなた",
  "fighter.cpuRival": "CPUライバル",
  "fighter.onlineRival": "対戦相手",
  "fighter.playerName": "プレイヤー1",
  "fighter.cpuName": "カードボット",
  "fighter.blockRemaining": "ブロック 残り{seconds}秒",
  "skillDrop.kicker": "スキル出現",
  "skillDrop.claiming": "獲得中…",
  "skillDrop.prompt": "役を先に出して獲得！",
  "start.eyebrow": "CPUバトル・スピードポーカー",
  "start.title": "役をつないで、HPをゼロにしよう！",
  "start.rulesLabel": "ルール概要",
  "start.cards": "5枚",
  "start.hp": "HP 100",
  "start.activeBattle": "リアルタイム対戦",
  "start.button": "スタート",
  "start.openAfter": "5秒後にカードオープン",
  "start.help": "カードを選んで交換、できた役ボタンでそのまま攻撃！",
  "mode.eyebrow": "プレイモード",
  "mode.title": "どちらで対戦する？",
  "mode.cpu": "CPUバトル",
  "mode.cpuDetail": "すぐに1人でプレイ",
  "mode.online": "オンライン PvP",
  "mode.onlineDetail": "同じWi-Fiの相手と対戦",
  "mode.back": "モード選択に戻る",
  "cpuStrength.eyebrow": "CPUバトル",
  "cpuStrength.title": "CPUの強さを選択",
  "cpuStrength.groupLabel": "CPUの強さ",
  "cpuStrength.normal": "NORMAL",
  "cpuStrength.normalDetail": "現在と同じ速さ・おすすめ",
  "cpuStrength.strong": "STRONG",
  "cpuStrength.strongDetail": "CPUがより素早く行動",
  "cpuStrength.back": "対戦方法に戻る",
  "online.eyebrow": "LANオンライン対戦",
  "online.title": "部屋を作る・参加する",
  "online.displayName": "表示名",
  "online.displayNamePlaceholder": "あなたの名前",
  "online.displayNameHelp": "1〜16文字。アカウント登録は不要です。",
  "online.createRoom": "部屋を作る",
  "online.or": "または",
  "online.roomCode": "6文字の部屋コード",
  "online.roomCodePlaceholder": "ABC 789",
  "online.roomCodeHelp": "招待URLをそのまま貼り付けても参加できます。",
  "online.joinRoom": "コードで参加",
  "online.connecting": "接続中…",
  "online.connectionFailed": "対戦サーバーへ接続できませんでした。PCでLANサーバーが起動しているか確認してください。",
  "online.invalidName": "表示名を1〜16文字で入力してください。",
  "online.invalidCode": "6文字の部屋コードを確認してください。",
  "online.roomNotFound": "部屋が見つかりません。コードを確認してください。",
  "online.roomFull": "この部屋は満員です。",
  "online.serverError": "サーバーで問題が発生しました。もう一度お試しください。",
  "online.lobby": "対戦ロビー",
  "online.waitingPlayer": "相手の参加を待っています",
  "online.waitingReady": "双方のスタートを待っています",
  "online.roomLabel": "部屋コード",
  "online.inviteHelp": "このリンクかコードを、同じWi-Fiの相手へ送ってください。",
  "online.shareInvite": "招待を共有",
  "online.copyLink": "リンクをコピー",
  "online.copyCode": "コードをコピー",
  "online.copied": "コピーしました！",
  "online.showQr": "QRを表示",
  "online.hideQr": "QRを閉じる",
  "online.qrTitle": "QR招待",
  "online.qrPending": "読み取り用QRは公開サーバー接続時に有効になります。現在はリンクまたはコードをご利用ください。",
  "online.qrReady": "スマートフォンのカメラで読み取ると、この部屋を開けます。",
  "online.qrAlt": "この対戦部屋へ参加するQRコード",
  "online.qrLoading": "QRを作成中…",
  "online.qrError": "QRを作成できませんでした",
  "online.localUrlWarning": "このURLはスマホから開けません。PC側も起動時に表示される Network URL（192.168…）で開き直してください。",
  "online.players": "プレイヤー",
  "online.you": "あなた",
  "online.openSeat": "参加待ち",
  "online.connected": "接続中",
  "online.disconnected": "切断中",
  "online.ready": "準備OK",
  "online.notReady": "待機中",
  "online.start": "スタート",
  "online.cancelReady": "準備を取り消す",
  "online.needOpponent": "相手が参加するとスタートできます",
  "online.waitOpponentReady": "相手のスタートを待っています",
  "online.countdown": "対戦開始まで",
  "online.matchConnected": "オンライン対戦の接続が成立しました",
  "online.matchPending": "対戦画面との同期は次の実装段階で接続します。",
  "online.paused": "相手の再接続を 待っています…",
  "online.leave": "退出",
  "countdown.ready": "準備して！",
  "matchTimer.label": "残り時間",
  "matchTimer.aria": "残り{seconds}秒",
  "matchTimer.finalCountdown": "タイムアップまで",
  "result.kicker": "対戦結果",
  "result.win": "勝利！",
  "result.lose": "敗北",
  "result.draw": "引き分け！",
  "result.winDetail": "CPUのHPをゼロにした！",
  "result.loseDetail": "もう一度、素早く役を作ろう！",
  "result.drawDetail": "同じ瞬間にダブルKO！",
  "result.onlineWinDetail": "相手のHPをゼロにした！",
  "result.onlineLoseDetail": "次はもっと素早く役をつなごう！",
  "result.timeUpWinDetail": "TIME UP — HP判定で勝利！",
  "result.timeUpLoseDetail": "TIME UP — HP判定で敗北",
  "result.timeUpDrawDetail": "TIME UP — 同じHPで引き分け！",
  "result.playAgain": "もう一度プレイ",
  "result.waitRematch": "相手の再戦準備を待っています…",
  "hand.cpu": "CPUの手札",
  "hand.opponent": "相手の手札",
  "hand.player": "自分の手札",
  "skills.cpu": "CPUのスキル",
  "skills.opponent": "相手のスキル",
  "skills.player": "自分のスキル",
  "skills.empty": "空き",
  "skills.ready": "使用可能",
  "skills.stocked": "保有中",
  "skills.itemLabel": "{skill}、{status}",
  "skills.useLabel": "{skill}を使用、{status}",
  "roles.groupLabel": "役の発動とカード交換",
  "roles.activateLabel": "{role}、{damage}ダメージを発動",
  "roles.disabledLabel": "{role}、{damage}ダメージ、現在使用不可",
  "roles.damage": "{damage} ダメージ",
  "roles.discard": "捨ててシャッフル",
  "roles.discardLabel": "{count}枚を捨ててシャッフル{disabled}",
  "roles.unavailable": "、現在使用不可",
  "roles.cardsCount": "{count}枚",
  "roles.selectCards": "カードを選択",
  "roles.none": "役なし — カードを選んで交換！",
  "card.hearts": "ハート",
  "card.diamonds": "ダイヤ",
  "card.clubs": "クラブ",
  "card.spades": "スペード",
  "card.faceDown": "裏向きのカード",
  "card.empty": "空のカード枠",
  "card.label": "{rank}の{suit}{selected}",
  "card.selected": "、交換対象に選択中",
  "hp.enemy": "相手",
  "hp.player": "自分",
  "hp.label": "{side}のHP",
  "hp.groupLabel": "HP状況",
  "status.ready": "行動可能",
  "status.cooldown": "クールダウン {seconds}",
  "status.stopped": "停止中 {seconds}",
  "status.sending": "処理中…",
  "status.rejected": "操作できません",
  "status.reconnecting": "再接続中…",
  "status.offline": "オフライン",
  "status.handLocked": "役・交換不可／スキル使用可",
  "impact.hit": "{count}ヒット！",
  "impact.damage": "ダメージ！",
  "impact.block": "ブロック！",
  "footer.discard": "カード選択 → 捨ててシャッフル",
  "footer.attack": "役ボタン → 即攻撃",
  "footer.fullscreen": "全画面表示",
  "notice.selectUnavailable": "今はカードを選べません",
  "notice.shuffled": "{count}枚をシャッフル！",
  "notice.go": "GO！ 役を作って攻撃！",
  "notice.roleActivated": "{role}！",
  "notice.blockAll": "ブロック！ 攻撃ダメージを完全ガード！",
  "notice.blockOne": "ブロック！ 一方の攻撃を完全ガード！",
  "notice.claimBoth": "{skill}を両者が獲得！",
  "notice.claimPlayer": "{skill}を獲得！",
  "notice.claimCpu": "CPUが{skill}を獲得",
  "notice.claimFull": "{skill}は満杯で消滅",
  "notice.dropExpired": "スキルは消えてしまった…",
  "notice.dropAppeared": "{skill}が出現！ 役を先に発動！",
  "notice.shuffleLocked": "シャッフル中は操作できません",
  "notice.skillCooldown": "スキルはクールダウン中です",
  "notice.skillUnavailable": "そのスキルは使えません",
  "notice.stopLocked": "停止中は役と交換が使えません",
  "notice.actionCooldown": "アクションはクールダウン中です",
  "notice.actionUnavailable": "その操作は現在使えません",
  "notice.noEffect": "{owner}{skill} — 効果なし",
  "notice.healed": "{owner}回復 +{amount}",
  "notice.stopped": "{owner}ストップ！ 役と交換をロック",
  "notice.blocked": "{owner}ブロック！ {duration}秒間ダメージ無効",
  "notice.forcedShuffle": "{owner}シャッフル！ 手札を強制更新",
  "notice.stolen": "{owner}スティール！ スキルを奪取",
  "notice.cpuOwner": "CPU：",
  "error.skillWeights": "スキル抽選の重みを1つ以上設定してください。",
} as const;

type TranslationKey = keyof typeof ja;
type TranslationParams = Record<string, string | number>;

const en: Record<TranslationKey, string> = {
  "language.label": "Language",
  "language.japanese": "Japanese",
  "language.english": "English",
  "top.liveLocal": "LIVE LOCAL",
  "top.cpuMode": "CPU MODE",
  "top.chooseMode": "CHOOSE MODE",
  "top.lanOnline": "LAN ONLINE",
  "top.soundOn": "Turn sound on",
  "top.soundOff": "Mute sound",
  "fighter.you": "YOU",
  "fighter.cpuRival": "CPU RIVAL",
  "fighter.onlineRival": "OPPONENT",
  "fighter.playerName": "PLAYER 1",
  "fighter.cpuName": "CARD BOT",
  "fighter.blockRemaining": "BLOCK, {seconds} seconds remaining",
  "skillDrop.kicker": "SKILL DROP",
  "skillDrop.claiming": "CLAIMING…",
  "skillDrop.prompt": "PLAY A HAND TO CLAIM!",
  "start.eyebrow": "CPU BATTLE • SPEED POKER",
  "start.title": "Chain poker hands and knock HP down to zero!",
  "start.rulesLabel": "Game rules",
  "start.cards": "5 CARDS",
  "start.hp": "100 HP",
  "start.activeBattle": "ACTIVE BATTLE",
  "start.button": "START",
  "start.openAfter": "Cards open in 5 seconds",
  "start.help": "Select cards to redraw, then hit a hand button to attack!",
  "mode.eyebrow": "PLAY MODE",
  "mode.title": "Choose your battle",
  "mode.cpu": "CPU BATTLE",
  "mode.cpuDetail": "Play solo right away",
  "mode.online": "ONLINE PvP",
  "mode.onlineDetail": "Battle someone on the same Wi-Fi",
  "mode.back": "Back to mode select",
  "cpuStrength.eyebrow": "CPU BATTLE",
  "cpuStrength.title": "Choose CPU strength",
  "cpuStrength.groupLabel": "CPU strength",
  "cpuStrength.normal": "NORMAL",
  "cpuStrength.normalDetail": "Current speed • Recommended",
  "cpuStrength.strong": "STRONG",
  "cpuStrength.strongDetail": "CPU acts more quickly",
  "cpuStrength.back": "Back to battle modes",
  "online.eyebrow": "LAN ONLINE BATTLE",
  "online.title": "Create or join a room",
  "online.displayName": "Display name",
  "online.displayNamePlaceholder": "Your name",
  "online.displayNameHelp": "1–16 characters. No account required.",
  "online.createRoom": "CREATE ROOM",
  "online.or": "OR",
  "online.roomCode": "6-character room code",
  "online.roomCodePlaceholder": "ABC 789",
  "online.roomCodeHelp": "You can also paste the full invite URL.",
  "online.joinRoom": "JOIN WITH CODE",
  "online.connecting": "CONNECTING…",
  "online.connectionFailed": "Could not reach the battle server. Check that the LAN server is running on the PC.",
  "online.invalidName": "Enter a display name from 1 to 16 characters.",
  "online.invalidCode": "Check the 6-character room code.",
  "online.roomNotFound": "Room not found. Check the code.",
  "online.roomFull": "This room is full.",
  "online.serverError": "The server had a problem. Please try again.",
  "online.lobby": "BATTLE LOBBY",
  "online.waitingPlayer": "WAITING FOR AN OPPONENT",
  "online.waitingReady": "WAITING FOR BOTH PLAYERS",
  "online.roomLabel": "ROOM CODE",
  "online.inviteHelp": "Send this link or code to someone on the same Wi-Fi.",
  "online.shareInvite": "SHARE INVITE",
  "online.copyLink": "COPY LINK",
  "online.copyCode": "COPY CODE",
  "online.copied": "COPIED!",
  "online.showQr": "SHOW QR",
  "online.hideQr": "HIDE QR",
  "online.qrTitle": "QR INVITE",
  "online.qrPending": "The scannable QR will be enabled with the public server. For now, use the link or room code.",
  "online.qrReady": "Scan with a phone camera to open this room.",
  "online.qrAlt": "QR code to join this battle room",
  "online.qrLoading": "CREATING QR…",
  "online.qrError": "COULD NOT CREATE QR",
  "online.localUrlWarning": "Phones cannot open this URL. Reopen the game on the PC using the Network URL (192.168…) shown at startup.",
  "online.players": "PLAYERS",
  "online.you": "YOU",
  "online.openSeat": "OPEN SEAT",
  "online.connected": "CONNECTED",
  "online.disconnected": "DISCONNECTED",
  "online.ready": "READY",
  "online.notReady": "WAITING",
  "online.start": "START",
  "online.cancelReady": "CANCEL READY",
  "online.needOpponent": "START unlocks when an opponent joins",
  "online.waitOpponentReady": "Waiting for your opponent to press START",
  "online.countdown": "BATTLE STARTS IN",
  "online.matchConnected": "ONLINE MATCH CONNECTED",
  "online.matchPending": "Battle-screen synchronization will connect in the next implementation step.",
  "online.paused": "Waiting for your opponent to reconnect…",
  "online.leave": "LEAVE",
  "countdown.ready": "GET READY",
  "matchTimer.label": "TIME LEFT",
  "matchTimer.aria": "{seconds} seconds remaining",
  "matchTimer.finalCountdown": "TIME UP IN",
  "result.kicker": "MATCH RESULT",
  "result.win": "YOU WIN!",
  "result.lose": "YOU LOSE",
  "result.draw": "DRAW!",
  "result.winDetail": "You knocked the CPU's HP down to zero!",
  "result.loseDetail": "Try again and build hands faster!",
  "result.drawDetail": "A double KO at the exact same moment!",
  "result.onlineWinDetail": "You knocked your opponent's HP down to zero!",
  "result.onlineLoseDetail": "Chain your hands faster next time!",
  "result.timeUpWinDetail": "TIME UP — YOU WIN ON HP!",
  "result.timeUpLoseDetail": "TIME UP — YOU LOSE ON HP",
  "result.timeUpDrawDetail": "TIME UP — EQUAL HP, DRAW!",
  "result.playAgain": "PLAY AGAIN",
  "result.waitRematch": "WAITING FOR OPPONENT…",
  "hand.cpu": "CPU hand",
  "hand.opponent": "Opponent hand",
  "hand.player": "Your hand",
  "skills.cpu": "CPU skills",
  "skills.opponent": "Opponent skills",
  "skills.player": "Your skills",
  "skills.empty": "EMPTY",
  "skills.ready": "READY",
  "skills.stocked": "STOCKED",
  "skills.itemLabel": "{skill}, {status}",
  "skills.useLabel": "Use {skill}, {status}",
  "roles.groupLabel": "Activate a hand or redraw cards",
  "roles.activateLabel": "Activate {role} for {damage} damage",
  "roles.disabledLabel": "{role}, {damage} damage, currently unavailable",
  "roles.damage": "{damage} DMG",
  "roles.discard": "DISCARD & SHUFFLE",
  "roles.discardLabel": "Discard and shuffle {count} cards{disabled}",
  "roles.unavailable": ", currently unavailable",
  "roles.cardsCount": "{count} CARDS",
  "roles.selectCards": "SELECT CARDS",
  "roles.none": "NO HAND — SELECT CARDS TO REDRAW!",
  "card.hearts": "hearts",
  "card.diamonds": "diamonds",
  "card.clubs": "clubs",
  "card.spades": "spades",
  "card.faceDown": "Face-down card",
  "card.empty": "Empty card slot",
  "card.label": "{rank} of {suit}{selected}",
  "card.selected": ", selected for redraw",
  "hp.enemy": "Opponent",
  "hp.player": "Your",
  "hp.label": "{side} HP",
  "hp.groupLabel": "HP status",
  "status.ready": "ACTION READY",
  "status.cooldown": "COOLDOWN {seconds}",
  "status.stopped": "STOP {seconds}",
  "status.sending": "SENDING…",
  "status.rejected": "ACTION REJECTED",
  "status.reconnecting": "RECONNECTING…",
  "status.offline": "OFFLINE",
  "status.handLocked": "HAND LOCKED • SKILLS READY",
  "impact.hit": "{count} HIT!",
  "impact.damage": "DAMAGE!",
  "impact.block": "BLOCK!",
  "footer.discard": "SELECT CARDS → DISCARD & SHUFFLE",
  "footer.attack": "HAND BUTTON → INSTANT ATTACK",
  "footer.fullscreen": "FULLSCREEN",
  "notice.selectUnavailable": "Cards cannot be selected right now",
  "notice.shuffled": "Shuffled {count} cards!",
  "notice.go": "GO! BUILD A HAND AND ATTACK!",
  "notice.roleActivated": "{role}!",
  "notice.blockAll": "BLOCK! ALL ATTACK DAMAGE GUARDED!",
  "notice.blockOne": "BLOCK! ONE ATTACK COMPLETELY GUARDED!",
  "notice.claimBoth": "Both players claimed {skill}!",
  "notice.claimPlayer": "You claimed {skill}!",
  "notice.claimCpu": "CPU claimed {skill}",
  "notice.claimFull": "{skill} vanished because the stock was full",
  "notice.dropExpired": "The skill disappeared…",
  "notice.dropAppeared": "{skill} appeared! Play a hand first!",
  "notice.shuffleLocked": "Controls are locked during SHUFFLE",
  "notice.skillCooldown": "Skills are cooling down",
  "notice.skillUnavailable": "That skill cannot be used",
  "notice.stopLocked": "Hands and redraws are locked during STOP",
  "notice.actionCooldown": "Actions are cooling down",
  "notice.actionUnavailable": "That action is currently unavailable",
  "notice.noEffect": "{owner}{skill} — NO EFFECT",
  "notice.healed": "{owner}HEAL +{amount}",
  "notice.stopped": "{owner}STOP! HANDS AND REDRAWS LOCKED",
  "notice.blocked": "{owner}BLOCK! DAMAGE IMMUNE FOR {duration} SEC",
  "notice.forcedShuffle": "{owner}SHUFFLE! HAND FORCIBLY REDRAWN",
  "notice.stolen": "{owner}STEAL! SKILL TAKEN",
  "notice.cpuOwner": "CPU: ",
  "error.skillWeights": "Set at least one skill draw weight.",
};

let activeLocale: Locale = detectInitialLocale();

function detectInitialLocale(): Locale {
  if (typeof window !== "undefined") {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === "ja" || saved === "en") return saved;
    } catch {
      // Some privacy modes deny storage; browser-language detection still works.
    }
  }
  if (typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("ja")) {
    return "ja";
  }
  return "en";
}

function interpolate(message: string, params: TranslationParams = {}) {
  return message.replace(/\{(\w+)\}/g, (_, key: string) => String(params[key] ?? `{${key}}`));
}

export function getLocale() {
  return activeLocale;
}

export function translate(
  key: TranslationKey,
  params?: TranslationParams,
  locale: Locale = activeLocale,
) {
  return interpolate((locale === "ja" ? ja : en)[key], params);
}

function applyLocale(locale: Locale, persist: boolean) {
  activeLocale = locale;
  if (typeof document !== "undefined") document.documentElement.lang = locale;
  if (persist && typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // Keep the in-memory choice even when persistent storage is unavailable.
    }
  }
}

export function localizeSkill(type: SkillType, locale: Locale = activeLocale, healAmount = 20) {
  if (locale === "en") return type === "HEAL" ? `HEAL +${healAmount}` : type;
  const labels: Record<SkillType, string> = {
    HEAL: `回復 +${healAmount}`,
    STOP: "ストップ",
    SHUFFLE: "シャッフル",
    STEAL: "スティール",
    BLOCK: "ブロック",
  };
  return labels[type];
}

export function localizeHand(
  type: HandType,
  ranks: readonly CardRank[],
  locale: Locale = activeLocale,
) {
  const rank = (index: number) => RANK_LABELS[ranks[index]];
  if (locale === "en") {
    switch (type) {
      case "one_pair": return `PAIR ${rank(0)}`;
      case "two_pair": return `TWO PAIR ${rank(0)}/${rank(1)}`;
      case "three_of_a_kind": return `THREE ${rank(0)}`;
      case "straight": return `STRAIGHT ${rank(0)} HIGH`;
      case "flush": return "FLUSH";
      case "full_house": return `FULL HOUSE ${rank(0)} OVER ${rank(1)}`;
      case "four_of_a_kind": return `FOUR ${rank(0)}`;
      case "straight_flush": return `STRAIGHT FLUSH ${rank(0)} HIGH`;
      case "royal_flush": return "ROYAL FLUSH";
    }
  }
  switch (type) {
    case "one_pair": return `ワンペア ${rank(0)}`;
    case "two_pair": return `ツーペア ${rank(0)}/${rank(1)}`;
    case "three_of_a_kind": return `スリーカード ${rank(0)}`;
    case "straight": return `ストレート ${rank(0)}ハイ`;
    case "flush": return "フラッシュ";
    case "full_house": return `フルハウス ${rank(0)}/${rank(1)}`;
    case "four_of_a_kind": return `フォーカード ${rank(0)}`;
    case "straight_flush": return `ストレートフラッシュ ${rank(0)}ハイ`;
    case "royal_flush": return "ロイヤルフラッシュ";
  }
}

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

const I18nContext = createContext<I18nContextValue>({
  locale: activeLocale,
  setLocale: () => undefined,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => activeLocale);
  const setLocale = useCallback((nextLocale: Locale) => {
    applyLocale(nextLocale, true);
    setLocaleState(nextLocale);
  }, []);
  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);
  useEffect(() => applyLocale(locale, false), [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const { locale, setLocale } = useContext(I18nContext);
  const t = useCallback(
    (key: TranslationKey, params?: TranslationParams) => translate(key, params, locale),
    [locale],
  );
  return { locale, setLocale, t };
}
