(function () {
  const ROOT = (window.BTE = window.BTE || {});

  // Bilibili slang that machine translation gets wrong (草 comes back as "grass").
  // LINE: the whole danmaku/comment is just this. Single characters that are also normal words
  // (草莓, 典型) are only matched here, never inside a sentence.
  const LINE_EN = {
    "草": "lol",
    "艹": "lol",
    "典": "Classic.",
    "急了": "Somebody's mad.",
    "他急了": "He's mad.",
    "寄": "It's over.",
    "寄了": "It's over.",
    "裂开": "I'm devastated.",
    "真香": "Okay, it's actually great.",
    "好家伙": "Wow.",
    "芜湖": "Woohoo!",
    "起飞": "Let's go!",
    "啊对对对": "Yeah yeah, sure.",
    "对对对": "Yeah, yeah, yeah.",
    "三连": "Liked, coined and favorited!",
    "下次一定": "Next time, for sure (no coins today).",
    "来了": "I'm here!",
    "前排": "Front row!",
    "打卡": "Checking in!",
    "泪目": "Tearing up.",
    "破防了": "That hit me hard.",
    "破防": "That hit me hard.",
    "下饭": "So good to watch while eating.",
    "绷不住了": "I can't hold it in.",
    "蚌埠住了": "I can't hold it in.",
    "爷青回": "My childhood is back!",
    "爷青结": "My childhood is over.",
    "妈妈生的": "Wow, that's beyond me.",
    "有内味了": "Now that's the vibe.",
    "名场面": "Iconic scene.",
    "高能预警": "Intense moment ahead!",
    "前方高能": "Epic moment ahead!",
    "完结撒花": "The end, congrats!",
    "awsl": "I'm dying (it's too cute)",
    "yyds": "The GOAT",
    "xswl": "LMAO",
    "nsdd": "So true",
    "dbq": "Sorry",
    "zqsg": "Heartfelt",
    "nbcs": "Nobody cares",
    "u1s1": "Honestly",
  };

  // INLINE: unambiguous terms replaced inside a sentence before it is translated (English only).
  const INLINE_EN = [
    ["一键三连", "like, coin and favorite"],
    ["UP主", "uploader"],
    ["up主", "uploader"],
    ["前方高能", "epic moment ahead"],
    ["高能预警", "intense moment warning"],
    ["蚌埠住了", "can't hold it in"],
    ["绷不住了", "can't hold it in"],
    ["破大防", "totally wrecked me"],
    ["爷青回", "my childhood is back"],
    ["爷青结", "my childhood is over"],
    ["绝绝子", "absolutely amazing"],
    ["名场面", "iconic scene"],
    ["白嫖", "freeloading"],
    ["内卷", "rat race"],
    ["躺平", "lying flat"],
    ["摆烂", "giving up"],
    ["鬼畜", "meme remix"],
    ["泪目", "tearing up"],
    ["我哭死", "I'm so moved"],
    ["打call", "cheer for"],
    ["弹幕", "danmaku"],
  ];
  const INLINE_LATIN_EN = { yyds: "the GOAT", awsl: "I'm dying", xswl: "LMAO", nsdd: "so true", dbq: "sorry", u1s1: "honestly" };

  const LAUGH = { en: "Hahaha", fr: "Hahaha", es: "Jajaja", pt: "Kkkkk", id: "Wkwkwk", vi: "Hahaha", ru: "Ахаха", ja: "www", ko: "ㅋㅋㅋ", th: "555" };
  const TRAILING = /[\s!！。.~～?？…]+$/;

  function base(lang) {
    return String(lang || "en").toLowerCase().split(/[-_]/)[0];
  }

  const CHAT_AREAS = new Set(["danmaku", "comments"]);

  // A line that is only a meme or laughter, answered without asking a translator. Memes only count
  // in danmaku and comments: elsewhere "2333" is a number and 草 is grass.
  function line(text, lang, area) {
    const raw = String(text || "").trim();
    if (!raw || raw.length > 12) return null;
    const t = raw.replace(TRAILING, "");
    const target = base(lang);
    if (/^(哈){2,}$|^(哈|呵|嘿|嘻){3,}$/.test(t)) return LAUGH[target] || null;
    if (target !== "en" || !CHAT_AREAS.has(area)) return null;
    if (/^2333+$/.test(t)) return "lol";
    if (/^6{3,}$/.test(t)) return "Nice!";
    if (/^[草艹]+$/.test(t)) return "lol";
    const skip = t.match(/^空降\s*(\d{1,2}[:：]\d{2}(?:[:：]\d{2})?)$/);
    if (skip) return `Skip to ${skip[1].replace(/：/g, ":")}`;
    return LINE_EN[t] || LINE_EN[t.toLowerCase()] || null;
  }

  // Slang inside a longer sentence, swapped for its meaning so the translator keeps it.
  function inline(text, lang) {
    if (base(lang) !== "en") return text;
    let out = String(text || "");
    if (!out) return out;
    for (const [term, meaning] of INLINE_EN) {
      if (out.includes(term)) out = out.split(term).join(` ${meaning} `);
    }
    if (/[a-z0-9]{4}/i.test(out)) {
      out = out.replace(/(^|[^A-Za-z0-9])(yyds|awsl|xswl|nsdd|dbq|u1s1)(?![A-Za-z0-9])/gi, (_m, lead, w) => `${lead} ${INLINE_LATIN_EN[w.toLowerCase()]} `);
    }
    return out.replace(/\s{2,}/g, " ").trim();
  }

  ROOT.Slang = { line, inline };
})();
