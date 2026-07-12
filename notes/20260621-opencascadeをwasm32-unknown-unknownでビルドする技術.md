# opencascadeをwasm32-unknown-unknownでビルドする技術【RustでCAD】

C++製のCADカーネル OpenCASCADE (OCCT) を `wasm32-unknown-unknown` 向けにビルドし、Rustから操作してブラウザだけでCADを完結させる話です。STEPファイルを選ぶと、サーバーに何も投げずにブラウザ内で GLB に変換して3D表示します。

- デモ: <https://lzpel.github.io/opencascade-wasm32-unknown-unknown-example/>
- リポジトリ: <https://github.com/lzpel/opencascade-wasm32-unknown-unknown-example>

この記事は「動かす手順」よりも、`wasm32-unknown-unknown` でOCCTを通そうとすると次々に出てくる鬼門と、その回避策に重点を置きます。これらの定型作業をまとめて引き受けてくれるのが私が公開している [`cadrum`](https://github.com/lzpel/cadrum) クレートで、その内部が何をしているかにも踏み込みます。

## TL;DR

`wasm32-unknown-unknown` でOCCTを動かすには、最低限これらを全部そろえる必要があります。

1. wasi-sdk の clang + sysroot でC++をクロスコンパイルする（`wasm32-unknown-unknown` には標準ライブラリもsysrootも無い）
2. C++グローバルコンストラクタ (`__wasm_call_ctors`) を手動で呼ぶ （呼ばないとOCCTの型テーブルが初期化されず初回呼び出しで trap）
3. wasm例外処理 (legacy EH) を有効化する （OCCTはC++例外を投げる）
4. wasm-opt / wasm-bindgen に新機能 (exception-handling / reference-types / bulk-memory) を理解させる

`cadrum` クレートと、そのクロスビルド用Dockerイメージ `ghcr.io/lzpel/cross-wasm32-unknown-unknown` が 1 と 4 のツールチェイン部分をまるごと用意します。

## なぜ `wasm32-unknown-unknown` が鬼門なのか

WebAssemblyのターゲットには大きく2系統あります。

- `wasm32-wasi`（現 `wasm32-wasip1`）: WASI のsysroot・libc・ファイルシステム抽象が前提。ランタイム（wasmtime等）かポリフィルが要る。
- `wasm32-unknown-unknown`: 何も無い。OSもlibcもsysrootも無い、純粋なブラウザ向けwasm。

ブラウザに `<model-viewer>` で出したいだけなのに WASI ランタイムを挟みたくない、という理由で後者を選ぶと、OCCTのような巨大なC++ライブラリを「libc/sysrootが存在しない世界」へ持ち込むことになります。ここから鬼門が始まります。

## ハマり①: C++グローバルコンストラクタが走らない

`wasm32-unknown-unknown` の cdylib/bin は `--no-entry` でリンクされるため、C++のグローバルコンストラクタ（OCCTの型テーブルを初期化するやつ）を走らせる `__wasm_call_ctors` が自動では呼ばれません。結果、最初のOCCT呼び出しでいきなり trap します。

解決は「自分で一度だけ `__wasm_call_ctors()` を呼ぶ」こと。最新のcadrumではこのctor直書きが正式な推奨スタイルです
```rust
/// Run OCCT's C++ global constructors. wasm32-unknown-unknown cdylib/bin links
/// with `--no-entry`, so the ctors that initialize OCCT's type tables are not run automatically; 
fn init_occt() {
	cadrum::__anchor_wasi_stub();
	extern "C" {
		fn __wasm_call_ctors();
	}
	unsafe { __wasm_call_ctors() };
}
```
（`src/main.rs`）

ポイントは2つ。

- `__wasm_call_ctors()` を `extern "C"` で引っ張ってきて、起動時に一度だけ `unsafe` で呼ぶ。
- `cadrum::__anchor_wasi_stub()` を呼ぶことで、`wasm32-unknown-unknown` に存在しないWASI由来のシンボルを埋めるスタブをリンクから落とされないようアンカーする。

## ハマり②: C++例外 = wasm例外処理 (legacy EH)

OCCTは内部でC++例外を投げます。これをwasmで成立させるには wasm exception-handling（cadrum は legacy エンコーディングでビルド）を有効にしてビルドする必要があります。そしてこの EH が、次に挙げる wasm-opt / wasm-bindgen 側の対応（ハマり③）を芋づる式に要求してきます。なお legacy エンコーディングなので、実行側は素のブラウザ / Node（`--experimental-wasm-exnref` フラグ不要）で動きます。

## ハマり③: wasm-opt が新機能を理解せず弾く

例外処理を使ったwasmは、`reference-types` や `bulk-memory` といった比較的新しいwasm機能も巻き込みます。ここでwasm-opt（binaryen）に機能を有効化して渡さないと、検証段階で `Tags require exception-handling` のようなエラーで止まります。

このexampleはビルドに [Trunk](https://trunkrs.dev/) を使っていて、`index.html` のリンクタグに属性で指定します。

```html
<!-- Build this crate to wasm.
     - data-wasm-opt="z": run wasm-opt (binaryen) with size optimization.
     - data-wasm-opt-params="-all": the OCCT/cadrum module uses wasm
       exception-handling (legacy encoding), reference-types, bulk-memory and
       other post-MVP features; enable all features so wasm-opt validates/
       optimizes it instead of rejecting `Tags require exception-handling`.
     - data-reference-types="true": wasm-bindgen needs an externref table for
       the Result<_, JsValue> catch wrappers, so reference-types must be on
       (independent of the exception-handling encoding). -->
<link data-trunk rel="rust" data-wasm-opt="z" data-wasm-opt-params="-all" data-reference-types="true" />
```
（`index.html`）

3つの属性の意味:

- `data-wasm-opt="z"`: wasm-opt をサイズ最適化（`-Oz`相当）で走らせる。
- `data-wasm-opt-params="-all"`: 全wasm機能を有効化して wasm-opt に渡す。exception-handling/reference-types/bulk-memory などを理解させ、「未知の命令なので拒否」を防ぐ。
- `data-reference-types="true"`: モジュールがすでに reference-types を有効にしているので、wasm-bindgen も externref テーブルを使うよう指示。`Result<_, JsValue>` の catch wrapper がこれに乗る。

### 実測: 後ろ2つの属性は本当に外すと落ちる

`data-wasm-opt="z"` はサイズ最適化を走らせるだけなので外しても「最適化されない」だけですが、残り2属性は本当に必須なのか、`make deploy-cross` で1つずつ外してビルドして確かめました。

**`data-wasm-opt-params="-all"` を外す** → wasm-opt が検証で失敗（exit 1）。`data-reference-types="true"` だけでは `--enable-reference-types` しか渡らず、例外処理機能が無効のまま弾かれます。

```
[wasm-validator error in module] unexpected false: Tags require exception-handling [--enable-exception-handling]
Fatal: error validating input
```

**`data-reference-types="true"` を外す** → 今度はその手前の wasm-bindgen が失敗（exit 1）。`Result<_, JsValue>` の catch wrapper を生成するのに externref テーブルが要る、と明示的に怒られます。

```
error: failed to generate catch wrappers
Caused by:
    externref table required for catch wrappers
```

というわけで、この2属性は**どちらも外すとビルドが通らない＝本物のハマりどころ**でした（`panic = "abort"` のように「あってもなくても同じ」ではありません）。

## ハマり④: ツールチェイン (wasi-sdk clang + sysroot)

ここまでの話は、そもそも C++を `wasm32-unknown-unknown` 向けにコンパイルできる前提で成り立っています。その前提を満たすのが wasi-sdk の clang + sysroot で、Rust/cc側に大量の環境変数をそろえる必要があります。`CC` / `CXX` / `CFLAGS` / `CXXFLAGS` / `RUSTFLAGS` / `CARGO_BUILD_TARGET` …といった具合です。

これを手で全部そろえるのは現実的ではないので、`cadrum` はプリセット済みのクロスビルド用Dockerイメージを公開しています。

```makefile
# cadrum's published cross image: wasi-sdk clang + sysroot and every wasm32 env
# var (CC/CXX/CFLAGS/CXXFLAGS/RUSTFLAGS, CARGO_BUILD_TARGET=wasm32) preset.
CROSS_IMAGE ?= ghcr.io/lzpel/cross-wasm32-unknown-unknown:latest
```
（`Makefile`）

このイメージの中でビルドすれば「wasi-sdk のセットアップ」を意識せずに済む、というのが肝です。

## cadrumが内部でやっていること

ここまでの①〜④をライブラリ＋イメージとして定型化したのが `cadrum` です。このexampleでは crates.io 版をsemverで固定して使っています。

```toml
# cadrum from crates.io, pinned by semver (^0.8 — cadrum's own README
# recommendation). Cargo.lock is committed for reproducible builds. Default
# features (color/png) match the known-good build.
cadrum = "^0.8"
```
（`Cargo.toml`）

READMEとMakefileから読み取れる範囲で、cadrumがやっていることは次の通りです。

- OCCTのprebuilt（C++）をリンクし、小さなC++ブリッジを `cc` でコンパイルして `wasm32-unknown-unknown` 向けに橋渡しする。
- WASI由来シンボルのスタブをアンカーする `cadrum::__anchor_wasi_stub()` を提供する。
- ツールチェイン（ハマり④）を `ghcr.io/lzpel/cross-wasm32-unknown-unknown` イメージとして提供する。wasi-sdk clang + sysroot と全wasm32環境変数がプリセットされているとされる。


```rust
fn main() {
	init_occt();
	// In the browser a window exists and we build the UI. Under Node (the
	// headless smoke test) `window()` is None, so we return without touching
	// the DOM and the test calls `chijin_glb()` directly.
	if web_sys::window().is_some() {
		build_ui().expect("failed to build UI");
	}
}
```
（`src/main.rs`）

## 実装: STEP → GLB をブラウザ内で

ビルドが通れば、あとはRustのCADコードがそのままブラウザで動きます。UIは三層構成です。

- Trunk（`--target web`）でwasm化。npmもバンドラも使わない。
- web-sys でDOMを直接組み立てる（`<h1>`、ファイル入力、`<model-viewer>`）。
- Google `<model-viewer>` をCDNから読み込み、GLBを表示。three.jsもnpm依存も無し。

中核の変換はこれだけです。STEPバイトを読み、メッシュ化し、GLB（バイナリglTF）として書き出す。

```rust
/// Convert STEP bytes to a binary glTF (GLB) entirely in-memory.
/// STEP -> Vec<Solid> -> Mesh -> GLB bytes.
#[wasm_bindgen]
pub fn step_to_glb(step: &[u8]) -> Result<Vec<u8>, JsValue> {
	let mut reader = Cursor::new(step);
	let solids = Solid::read_step(&mut reader)
		.map_err(|e| JsValue::from_str(&format!("read_step: {e:?}")))?;
	let mesh = Solid::mesh(solids.iter(), Default::default())
		.map_err(|e| JsValue::from_str(&format!("mesh: {e:?}")))?;
	let mut out: Vec<u8> = Vec::new();
	mesh.write_gltf_binary(&mut out)
		.map_err(|e| JsValue::from_str(&format!("gltf: {e:?}")))?;
	Ok(out)
}
```
（`src/main.rs`）

ファイルが選ばれたら、`File` を `ArrayBuffer` 経由でバイト列にして `step_to_glb` に渡し、結果のGLBをBlob→object URLにして `<model-viewer src>` に差し込みます。

```rust
async fn convert_file(file: &web_sys::File) -> Result<Vec<u8>, JsValue> {
	let buf = wasm_bindgen_futures::JsFuture::from(file.array_buffer()).await?;
	let bytes = js_sys::Uint8Array::new(&buf).to_vec();
	step_to_glb(&bytes)
}

/// Wrap GLB bytes in a Blob and return an object URL for `<model-viewer src>`.
fn glb_object_url(glb: &[u8]) -> Result<String, JsValue> {
	let parts = js_sys::Array::new();
	parts.push(&js_sys::Uint8Array::from(glb));
	let blob = web_sys::Blob::new_with_u8_array_sequence(&parts)?;
	web_sys::Url::create_object_url_with_blob(&blob)
}
```
（`src/main.rs`）

なお初期表示は、STEPファイルを同梱せずサンプルCADモデルをその場で生成して見せています。シリンダー本体・回転掃引したドラムヘッド・20個のレインボー編み込みブロックを、ブール演算で組み上げる例です。

## ビルド & デプロイ

ビルドは「クロスイメージの中で `make deploy` を回す」のを `make deploy-cross` でラップしています。

```makefile
.PHONY: deploy
deploy:
	unset CARGO_BUILD_TARGET; cargo install --locked --root ./target trunk
	./target/bin/trunk build --release --public-url "$(PUBLIC_URL)"

.PHONY: deploy-cross
deploy-cross:
	MSYS_NO_PATHCONV=1 docker run --rm -v "$(PWD)":/src -w /src -e CARGO_TARGET_DIR=/tmp/target $(CROSS_IMAGE) make deploy
```
（`Makefile`）

細かいが効くポイント:

- Trunkはイメージに入っていないので `./target/bin` に `cargo install` する。マウントされた作業ツリー上に置くので、再ビルド時は同バージョンならno-opで再利用される。
- イメージは `CARGO_BUILD_TARGET=wasm32...` をプリセットしているため、Trunk自体のインストール時だけ `unset` してホスト向けにビルドさせる。
- `MSYS_NO_PATHCONV=1` は Git-Bash/MSYS がコンテナ内パス（`/src`, `/tmp/target`）をWindowsパスに書き換えるのを止める（Linux/CIでは無害なno-op）。
- `CARGO_TARGET_DIR=/tmp/target` でビルド成果物をマウント外に逃がし、root所有の `target/` を作業ツリーに残さない。

CIはGitHub Actionsで、`make deploy-cross` の成果物 `dist/` をそのままGitHub Pagesへ公開します。

```yaml
- name: Build wasm site (make deploy-cross)
  run: make deploy-cross
```
（`.github/workflows/deploy.yml`）

## まとめ

`wasm32-unknown-unknown` でOpenCASCADEを動かす要点は、結局この4つに集約されます。

1. wasi-sdk clang + sysroot でC++をクロスコンパイルする
2. `__wasm_call_ctors` を手動で呼ぶ（グローバルコンストラクタ問題）
3. legacy EHを有効化する（OCCTのC++例外をwasmで成立させる。`--experimental-wasm-exnref` 無しで動く）
4. wasm-opt / wasm-bindgen に exception-handling / reference-types / bulk-memory を理解させる

これらは個別に踏むと相当に消耗しますが、`cadrum` クレートとそのクロスイメージがまとめて引き受けてくれるので、利用側は起動時にctorを直書きで1回呼ぶ（最新cadrumの推奨スタイル。旧 `wasm_start!` マクロは廃止）だけで、あとは普通のRust CADコードがブラウザで走ります。

タグ: `Rust` `WebAssembly` `OpenCASCADE` `CAD` `wasm`
