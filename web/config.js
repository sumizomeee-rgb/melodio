/*
  内置专辑库：《錦夢痕》与《梦寻未来》真实母带版。
  音频与封面随 APK 打包在 assets 中，启动即加载，完全离线。
  歌名从 audio 文件名读取（01 花漪.mp3 → 显示“花漪”）。
  多专辑时启动会显示专辑选择面板；单专辑时自动载入。
*/
window.MELODIO_ALBUMS = [
  {
    albumTitle: "錦夢痕",
    artist: "SUMi",
    tracks: [
      {
        audio: "assets/audio/01 花漪.mp3",
        image: "assets/images/01 花漪曲绘.jpg",
        subtitle: "花の時計が　記憶を舞わせる",
        kicker: "VOCALOID ORIGINAL"
      },
      {
        audio: "assets/audio/02 花延奏.mp3",
        image: "assets/images/01 花漪曲绘.jpg",
        subtitle: "霧を裂いて　記憶が静かに目覚める",
        kicker: "VOCALOID ORIGINAL"
      },
      {
        audio: "assets/audio/03 遠地点.mp3",
        image: "assets/images/cover.jpg",
        subtitle: "僕たちの心にひと粒の種",
        kicker: "VOCALOID ORIGINAL"
      },
      {
        audio: "assets/audio/04 願いの軌跡.mp3",
        image: "assets/images/cover.jpg",
        subtitle: "巡り巡って原点に戻った",
        kicker: "VOCALOID ORIGINAL"
      },
      {
        audio: "assets/audio/05 失くしたもの.mp3",
        image: "assets/images/05 带底截图.jpg",
        subtitle: "言葉はいらない",
        kicker: "VOCALOID ORIGINAL"
      }
    ]
  },
  {
    albumTitle: "梦寻未来",
    artist: "SUMi",
    tracks: [
      {
        audio: "assets/audio/01 未来夢地図.mp3",
        image: "assets/images/01 梦寻Miku 柄图.jpg",
        subtitle: "未来への地図を手にして",
        kicker: "VOCALOID ORIGINAL"
      },
      {
        audio: "assets/audio/02 変わってしまう夏色.mp3",
        image: "assets/images/02 夏色截图.jpg",
        subtitle: "蝉時雨に挟まれて",
        kicker: "VOCALOID ORIGINAL"
      },
      {
        audio: "assets/audio/03 可愛い君に会いたい.mp3",
        image: "assets/images/03 湘墨封面.jpg",
        subtitle: "たたた　たくさん話したい",
        kicker: "VOCALOID ORIGINAL"
      },
      {
        audio: "assets/audio/04 日曜日の12時半.mp3",
        image: "assets/images/03 湘墨封面.jpg",
        subtitle: "いつも通り覚めて",
        kicker: "VOCALOID ORIGINAL"
      },
      {
        audio: "assets/audio/05 龍行虎歩.mp3",
        image: "assets/images/05 连曲 深夜差分睁眼.jpg",
        subtitle: "東の国　赤い土",
        kicker: "VOCALOID ORIGINAL"
      },
      {
        audio: "assets/audio/06 夢を埋めるんだ.mp3",
        image: "assets/images/06 截左半身.jpg",
        subtitle: "いつも死に方を夢見て",
        kicker: "VOCALOID ORIGINAL"
      }
    ]
  }
];

/* 兼容别名：默认载入第一个专辑 */
window.ALBUM_CONFIG = window.MELODIO_ALBUMS[0];
