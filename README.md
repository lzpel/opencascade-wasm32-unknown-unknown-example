# cadrum-wasm-example — STEP → GLB in the browser

A minimal Next.js (App Router) **static site** that loads a wasm build of
[cadrum](https://github.com/lzpel/cadrum) pulled from GitHub `main`, converts an
uploaded STEP file to GLB **entirely in the browser**, and renders it with
Google `<model-viewer>`.

It exists to prove the `cadrum-occt-v800-rev1` **`wasm32-unknown-unknown`
prebuilt** works end-to-end (no `source-build`), and to document the wasm
runtime gotchas that the browser path hits.

## 🌐 公開URL / Live site

**https://lzpel.github.io/cadrum-wasm-example/**

(Self-test route: <https://lzpel.github.io/cadrum-wasm-example/selftest> — converts a
bundled sample and writes the result to the tab title.)

Built and deployed by GitHub Actions (`.github/workflows/deploy.yml`): it
cross-compiles the wasm with wasi-sdk-33, runs a headless Node smoke test, does
a Next.js static export, and publishes it to GitHub Pages.

---

## この経路は「ビルドのみ」で実行検証されていなかった — 3つのランタイム修正

cadrum の wasm CI は OCCT prebuilt を **ビルドするだけ** で、実際に *実行* して
検証していなかった。そのためブラウザでこの経路を初めて動かしたとき 3 つの実行時
問題に当たり、本リポジトリ側で次の 3 点を修正して初めて動作した:

1. **WASI import シム** — cadrum の wasm は `wasi_snapshot_preview1` を import する
   が、wasm-pack `--target web` はバンドラが解決できない裸の import を出力する。
   最小の [`wasm/wasi_shim.js`](wasm/wasi_shim.js) を用意し、生成 glue を
   [`wasm/patch_glue.mjs`](wasm/patch_glue.mjs) で書き換えてそこへ繋ぐ。
   （cadrum の OSD レイヤは build.rs でスタブ済みなので、変換はファイルシステムに
   触れない。`fd_write` だけ console に流して panic を可視化する。）

2. **例外処理 `wasm-opt --translate-to-exnref`** — OCCT(C++) は clang
   `-fwasm-exceptions`(新 EH モデル)で、rustc は既定で *レガシー* EH を出す。
   1 つの wasm モジュールに両者を混在させることはできず、Chrome は
   *"module uses a mix of legacy and new exception handling instructions"* で
   拒否する。[`wasm/build.sh`](wasm/build.sh) はビルド後に
   `wasm-opt -all --translate-to-exnref` でモジュール全体を単一の exnref モデルへ
   正規化する。

3. **`__wasm_call_ctors` の強制 export と init 時呼び出し** — OCCT は型システムと
   ディスパッチテーブル(STEP パースを駆動)を **C++ グローバルコンストラクタ** で
   登録する。それらは `__wasm_call_ctors` 内で走るが、wasm-bindgen の
   `--target web` glue は `wasm32-unknown-unknown` cdylib に対してこれを呼ばない。
   そのため最初の OCCT 呼び出しが未初期化テーブルを踏み
   *"null function or function signature mismatch"* になる。
   `build.sh` がリンカフラグ `--export=__wasm_call_ctors` で export を強制し、
   `patch_glue.mjs` が init 時に `wasm.__wasm_call_ctors()` を呼ぶ。

---

## どうすれば修正不要にできるか（上流 = cadrum 側への提案）

3 点とも本来は **cadrum 側で吸収できる**。そうすれば下流（このリポジトリ）の
JS シムや glue 書き換え・wasm-opt 後処理は不要になる。

- **(1) WASI シムを不要に** — cadrum の wasm ビルドで、`wasi_snapshot_preview1` を
  in-tree のスタブ（`sandbox-wasm/src/wasi_stub.c` 相当を whole-archive リンク）で
  満たし、import 自体を残さない。`sandbox-wasm` は既にこの方式で Node 実行できて
  いる。import が消えればバンドラは何も解決する必要がなく、`wasi_shim.js` +
  `patch_glue.mjs` の import 書き換えは丸ごと不要になる。

- **(2) `--translate-to-exnref` を不要に** — OCCT prebuilt と Rust codegen の EH
  エンコードを最初から揃える。具体的には cadrum が wasm32 向けに推奨
  `.cargo/config.toml`（`-C target-feature=+exception-handling`
  `-C llvm-args=-wasm-use-legacy-eh=false`）を提供する／あるいは prebuilt を
  exnref エンコードで配布する。両者が同一エンコードになれば、ビルド後の
  `wasm-opt --translate-to-exnref` 正規化は不要になる。
  （注: 現状は rustflags を揃えても prebuilt 側の差で正規化が必要なので、
  **prebuilt のエンコードを exnref に統一する**のが本筋。）

- **(3) `__wasm_call_ctors` を不要に** — cadrum の `build.rs` が wasm ターゲット時に
  `cargo:rustc-link-arg=--export=__wasm_call_ctors` を発行する（リンカ引数は最終
  cdylib のリンクへ伝播する）。さらに「init で一度呼ぶ」手順を cadrum 側の
  ドキュメント／薄い init ヘルパとして提供すれば、下流での強制 export と glue
  書き換えは不要になる。

> いずれも cadrum 本体の変更が必要なため、本リポジトリでは **提案の記載のみ**
> （cadrum は変更しない）。

---

## ブラウザではなく CLI（make / node）から実行して早期検知する

> 「wasm32-unknown-unknown をブラウザではなく makefile から起動できるなら、シムや
> 例外などに問題があることにすぐ気づけたはず。コマンドで可能か」

**可能。** ブラウザを開かずに `make test` で同じ wasm を **Node(V8)** 上で実行できる:

```sh
make test
# = cd wasm && npm install && bash build.sh   (wasm をビルド)
#   node --experimental-wasm-exnref run_node.mjs   (Node で変換を実行・検証)
```

Node の V8 はブラウザと同じ wasm の制約を課すため、**未修正のビルドは Node でも
同じエラーで落ちる**:

| 未対応の点 | Node / ブラウザ共通で出るエラー |
|---|---|
| (1) WASI import 未解決 | `WebAssembly.instantiate(): Import #… "wasi_snapshot_preview1"` が未定義 |
| (2) EH エンコード混在 | `module uses a mix of legacy and new exception handling instructions` |
| (3) `__wasm_call_ctors` 未実行 | `null function or function signature mismatch`（最初の OCCT 呼び出し） |

つまり「ビルドが通る」だけでなく **CLI で 1 回実行する**ステップを CI に入れれば、
これら 3 つはブラウザ実機に到達する前に検出できた。`run_node.mjs` は wasm-pack
`--target web` の init に `.wasm` バイト列を直接渡し（Node の `fetch` は file URL を
読めないため）、`public/colored_box_roundtrip.step` を `step_to_glb` に通して GLB
ヘッダ（magic `glTF` / version 2 / length 一致）を検証する。成功すると
`NODETEST:OK …` を出力して exit 0。CI でもこの Node テストを必須ステップにしている。

> 参考: cadrum の `sandbox-wasm/makefile` も
> `node -e "import('./target/…').then(m=>console.log(m.print_volume()))"` で wasm を
> Node 実行しており、CLI 実行は既に前例がある。

---

## レイアウト

```
cadrum-wasm-example/
├── wasm/                  # cadrum_web wasm クレート (cdylib + wasm-bindgen)
│   ├── Cargo.toml         #   cadrum = { git = "https://github.com/lzpel/cadrum" }  (PREBUILT)
│   ├── src/lib.rs         #   pub fn step_to_glb(&[u8]) -> Result<Vec<u8>, JsValue>
│   ├── build.sh           #   wasm-pack build + EH 正規化 + glue patch（Linux/Windows 両対応）
│   ├── wasi_shim.js        #   最小 wasi_snapshot_preview1 シム
│   ├── patch_glue.mjs      #   生成 ESM glue をブラウザ向けに書き換え
│   └── package.json        #   binaryen (wasm-opt) を devDependency に
├── app/                    # Next.js App Router
│   ├── layout.tsx          #   <model-viewer> を CDN から読み込み
│   ├── page.tsx            #   file 入力 → step_to_glb → Blob URL → <model-viewer>
│   └── selftest/page.tsx   #   自動セルフテスト（ヘッドレス確認用）
├── public/colored_box_roundtrip.step   # セルフテスト/CLI テストの入力サンプル
├── run_node.mjs            # CLI(Node) スモークテスト
├── Makefile                # make wasm / make test / make site
├── next.config.js          # output:'export' + PAGES_BASE_PATH
└── .github/workflows/deploy.yml        # build → Node test → static export → Pages
```

## ローカルで動かす

前提ツール（CI と同じ）: Rust + `wasm32-unknown-unknown` target、Node、
[`wasm-pack`](https://rustwasm.github.io/wasm-pack/)、
[wasi-sdk 33](https://github.com/WebAssembly/wasi-sdk/releases)（`WASI_SDK_PATH`
で場所を指定、未指定なら `wasm/wasi-sdk-33` などを探索）。

```sh
# 1) wasm をビルドして CLI で検証
make test                      # → NODETEST:OK …

# 2) 開発サーバ
make site                      # 静的 export (./out)
# もしくは
npm install && npm run dev     # http://localhost:3000
```

ブラウザで `.step`/`.stp` を選ぶと変換結果が `<model-viewer>` に表示される。
`/selftest` はバンドル済みサンプルで変換を自動実行する。

### Browser requirement

モジュールは wasm 例外処理 (exnref) を使う。最新の Chrome / Edge / Firefox を
利用すること。（Node は `--experimental-wasm-exnref` が必要。）
