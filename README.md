# cadrum-wasm-example — STEP → GLB in the browser

A minimal Next.js (App Router) **static site** that loads a wasm build of
[cadrum](https://github.com/lzpel/cadrum) pulled from GitHub, converts an
uploaded STEP file to GLB **entirely in the browser**, and renders it with
Google `<model-viewer>`.

It exists to prove the cadrum **`wasm32-unknown-unknown` prebuilt** works
end-to-end (no `source` build) with a **minimal** downstream setup: the three
wasm runtime problems an earlier version of this example had to work around are
now all solved upstream in cadrum, so this repo no longer ships a WASI shim, a
`wasm-opt` post-process, or any generated-glue patching.

## 🌐 公開URL / Live site

**https://lzpel.github.io/cadrum-wasm-example/**

(Self-test route: <https://lzpel.github.io/cadrum-wasm-example/selftest> — converts a
bundled sample and writes the result to the tab title.)

Built and deployed by GitHub Actions (`.github/workflows/deploy.yml`): it
cross-compiles the wasm with wasi-sdk-33, runs a headless Node smoke test, does
a Next.js static export, and publishes it to GitHub Pages.

---

## 3つのランタイム問題は cadrum 本体で解決済み

このサンプルの旧版は、cadrum を wasm で *実行* したとき初めて表面化する 3 つの
ランタイム問題を **下流（このリポジトリ）側で** 回避していた。現在はいずれも
**cadrum 本体が吸収している**ので、下流の JS シム・glue 書き換え・wasm-opt 後処理は
**すべて不要**になった。下流がやるのは「wasi-sdk のツールチェイン env を渡す」ことと
「`cadrum::wasm_start!()` を 1 行書く」ことだけ。

| 旧版の回避策（このリポジトリ側） | 現在（cadrum 本体が解決） |
|---|---|
| **(1)** `wasi_shim.js` を用意し生成 glue を書き換えて `wasi_snapshot_preview1` import を解決 | cadrum の `build.rs` が `cpp/wasi_stub.c` を `+whole-archive` で自動リンクし、wasm 出力を self-contained 化（import が残らない）。**シム不要** |
| **(2)** `wasm-opt --translate-to-exnref` で legacy/new EH 混在を正規化（binaryen 依存） | cadrum が OCCT と cxx ブリッジを `-mllvm -wasm-use-legacy-eh=false` で **exnref に統一**（#204）。Rust 側は `wasm32-unknown-unknown` が既定で abort なので legacy EH 命令を出さず、混在しない。**正規化不要** |
| **(3)** リンカで `--export=__wasm_call_ctors` を強制し JS init で手動呼び出し | cadrum の `wasm_start!()` マクロが `#[wasm_bindgen(start)]` shim を生成し、init 時に `__wasm_call_ctors()` を自動実行。**手動 export / glue 注入不要** |

結果として、このサンプルでやることは以下だけ:

- **`wasm/src/lib.rs`**: クレートルートに `cadrum::wasm_start!();` を 1 行
  （OCCT の C++ グローバルコンストラクタを init 時に走らせる。これが無いと最初の
  OCCT 呼び出しが未初期化テーブルを踏み *"null function or function signature
  mismatch"* になる）。
- **`wasm/build.sh`**: wasi-sdk clang/sysroot を指す toolchain env を設定して
  `wasm-pack build --target web` を呼ぶだけ（後処理ゼロ）。cadrum は prebuilt OCCT を
  使う場合でも cxx ブリッジ C++ を wasm 向けにローカルコンパイルするため、wasi-sdk は
  引き続き必要。

> cadrum 本体は変更しない。必要な修正はすべて上流（cadrum `main`）に取り込み済みで、
> このリポジトリはそれを `wasm/Cargo.toml` の git 依存で参照しているだけ。

### 何を削れて、何が残るか（実ビルドで確認）

「削れるものは積極的に削って必要最小限をあぶり出す」方針で、`make test`
（ビルド → Node 実行で `NODETEST:OK`）が通ることを確認しながら削った結果:

**削除できた（不要と判明）**

- `wasm/wasi_shim.js`、`wasm/patch_glue.mjs` — (1) を cadrum が解決。生成 glue の
  `wasi_snapshot_preview1` 出現数は **0**（import が残らない）。
- `wasm/package.json` と binaryen 依存、`build.sh` の `wasm-opt --translate-to-exnref`
  後処理 — (2) を cadrum が解決。
- `build.sh` の RUSTFLAGS から `--export=__wasm_call_ctors` / `+exception-handling` /
  `-wasm-use-legacy-eh=false` — (3) と (2) を cadrum が解決。
- `build.sh` の `CMAKE_GENERATOR` — prebuilt OCCT 経路では cmake が走らないため不要。
- `Cargo.toml` の `panic = "abort"` — wasm32-unknown-unknown は既定で abort なので冗長
  （外してビルドしても `NODETEST:OK`）。

**まだ必要（残した）**

- `wasm/src/lib.rs` の `cadrum::wasm_start!();`（無いと最初の OCCT 呼び出しが
  *"null function or function signature mismatch"*）。
- `build.sh` の wasi-sdk toolchain env：`CC/CXX/CFLAGS/CXXFLAGS_wasm32...` と
  RUSTFLAGS の `-L native=…/eh -l static=c++abi -l static=unwind -l static=c`。
  cadrum は prebuilt 利用時でも cxx ブリッジ C++ を wasm 向けにローカルコンパイル＆
  リンクするため、ツールチェイン指定は下流が渡す必要がある。
- `Cargo.toml` の `wasm-opt = false`（OCCT 由来 EH で binaryen が Precompute pass で
  クラッシュするのを避ける）。

---

## ブラウザではなく CLI（make / node）から実行して早期検知する

> 「wasm32-unknown-unknown をブラウザではなく makefile から起動できるなら、シムや
> 例外などに問題があることにすぐ気づけたはず。コマンドで可能か」

**可能。** ブラウザを開かずに `make test` で同じ wasm を **Node(V8)** 上で実行できる:

```sh
make test
# = cd wasm && bash build.sh                       (wasm をビルド)
#   node --experimental-wasm-exnref run_node.mjs   (Node で変換を実行・検証)
```

Node の V8 はブラウザと同じ wasm の制約を課すため、もし 3 点のいずれかが未解決なら
**Node でも同じエラーで落ちる**:

| 問題 | Node / ブラウザ共通で出るエラー |
|---|---|
| (1) WASI import 未解決 | `WebAssembly.instantiate(): Import #… "wasi_snapshot_preview1"` が未定義 |
| (2) EH エンコード混在 | `module uses a mix of legacy and new exception handling instructions` |
| (3) `__wasm_call_ctors` 未実行 | `null function or function signature mismatch`（最初の OCCT 呼び出し） |

現在は 3 点とも cadrum 側で解決済みなので、`make test` は素直に通り、`run_node.mjs` が
`public/colored_box_roundtrip.step` を `step_to_glb` に通して GLB ヘッダ（magic `glTF` /
version 2 / length 一致）を検証し、成功すると `NODETEST:OK …` を出力して exit 0。CI でも
この Node テストを必須ステップにしている。「ビルドが通る」だけでなく **CLI で 1 回実行する**
ステップを入れることで、これら 3 つはブラウザ実機に到達する前に検出できる。

---

## レイアウト

```
cadrum-wasm-example/
├── wasm/                  # cadrum_web wasm クレート (cdylib + wasm-bindgen)
│   ├── Cargo.toml         #   cadrum = { git = "https://github.com/lzpel/cadrum" }  (main を追跡)
│   ├── src/lib.rs         #   pub fn step_to_glb(&[u8]) -> Result<Vec<u8>, JsValue> + cadrum::wasm_start!()
│   └── build.sh           #   toolchain env をセットして wasm-pack build（Linux/Windows 両対応、後処理なし）
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
