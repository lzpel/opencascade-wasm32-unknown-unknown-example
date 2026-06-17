//! cadrum wasm: STEP → GLB, entirely in the browser.
//!
//! Built with Trunk (`--target web`). On load it generates the `00_chijin`
//! example geometry dynamically and renders it with Google `<model-viewer>`;
//! selecting a `.step`/`.stp` file converts it to GLB and swaps the model.
//!
//! Entry point is `fn main()` (Trunk/wasm-bindgen `--target web` runs it on
//! init). We do NOT use `cadrum::wasm_start!()` because that defines its own
//! `#[wasm_bindgen(start)]`, and wasm-bindgen allows only one start — which
//! must also launch the UI here.

use cadrum::{Color, DVec3, Edge, ProfileOrient, Solid};
use std::f64::consts::PI;
use std::io::Cursor;
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;

fn main() {
    init_occt();
    // In the browser a window exists and we build the UI. Under Node (the
    // headless smoke test) `window()` is None, so we return without touching
    // the DOM and the test calls `chijin_glb()` directly.
    if web_sys::window().is_some() {
        build_ui().expect("failed to build UI");
    }
}

/// Run OCCT's C++ global constructors. wasm32-unknown-unknown cdylib/bin links
/// with `--no-entry`, so the ctors that initialize OCCT's type tables are not
/// run automatically; without this the first OCCT call traps. This mirrors the
/// body of `cadrum::wasm_start!` (which we can't use — see module docs).
fn init_occt() {
    cadrum::__anchor_wasi_stub();
    extern "C" {
        fn __wasm_call_ctors();
    }
    unsafe { __wasm_call_ctors() };
}

// ── public wasm API ─────────────────────────────────────────────────────────

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

/// Build the `00_chijin` example geometry and return it as GLB. Pure (no DOM),
/// so the Node smoke test can call it; the browser uses it for the default model.
#[wasm_bindgen]
pub fn chijin_glb() -> Result<Vec<u8>, JsValue> {
    let result = [chijin().map_err(|e| JsValue::from_str(&format!("chijin: {e:?}")))?];
    let mesh = Solid::mesh(&result, Default::default())
        .map_err(|e| JsValue::from_str(&format!("mesh: {e:?}")))?;
    let mut out: Vec<u8> = Vec::new();
    mesh.write_gltf_binary(&mut out)
        .map_err(|e| JsValue::from_str(&format!("gltf: {e:?}")))?;
    Ok(out)
}

/// `chijin()` from cadrum `examples/00_chijin.rs` (file-IO stripped): a chijin
/// hand drum — cylinder body, revolve-swept drum heads, and 20 rainbow lacing
/// blocks with holes, assembled with boolean ops.
fn chijin() -> Result<Solid, cadrum::Error> {
    let cylinder = Solid::cylinder(15.0, DVec3::Y * 8.0)
        .translate(DVec3::Y * -4.0)
        .color("#999");

    let cross_section = Edge::polygon(&[
        DVec3::new(0.0, 5.0, 0.0),
        DVec3::new(15.0, 5.0, 0.0),
        DVec3::new(17.0, 3.0, 0.0),
        DVec3::new(15.0, 4.0, 0.0),
        DVec3::new(0.0, 4.0, 0.0),
    ])?;
    let spine = Edge::circle(1.0, DVec3::Y)?;
    let sheet = Solid::sweep(&cross_section, &[spine], ProfileOrient::Up(DVec3::Y))?.color("#fff");
    let sheets = [sheet.clone().mirror(DVec3::ZERO, DVec3::Y), sheet];

    let block_proto = Solid::cube(DVec3::ZERO, DVec3::new(2.0, 1.0, 8.0))
        .translate(DVec3::new(-1.0, -0.5, -4.0))
        .rotate_y(-60.0_f64.to_radians())
        .translate(DVec3::Z * 15.0);
    let hole_proto = Solid::cylinder(0.7, (DVec3::X * 10.0 + DVec3::Y * 30.0).normalize() * 30.0)
        .translate(DVec3::new(-5.0, -15.0, 16.0));

    const N: usize = 20;
    let angle = |i: usize| 2.0 * PI * (i as f64) / (N as f64);
    let color = |i: usize| Color::from_hsv(i as f32 / N as f32, 1.0, 1.0);
    let blocks: [Solid; N] = std::array::from_fn(|i| block_proto.clone().rotate_y(-angle(i)).color(color(i)));
    let holes: [Solid; N] = std::array::from_fn(|i| hole_proto.clone().rotate_y(-angle(i)));

    let mut result: Solid = (&cylinder + &sheets[0] + &sheets[1]).build()?;
    for i in 0..N {
        result = (&result - &holes[i] + &blocks[i]).build()?;
    }
    Ok(result)
}

// ── browser UI (web-sys) ────────────────────────────────────────────────────

fn build_ui() -> Result<(), JsValue> {
    let document = web_sys::window()
        .and_then(|w| w.document())
        .ok_or_else(|| JsValue::from_str("no document"))?;
    let body = document.body().ok_or_else(|| JsValue::from_str("no body"))?;

    let h1 = document.create_element("h1")?;
    h1.set_text_content(Some("cadrum wasm: STEP → GLB"));
    body.append_child(&h1)?;

    let input = document
        .create_element("input")?
        .dyn_into::<web_sys::HtmlInputElement>()?;
    input.set_type("file");
    input.set_accept(".step,.stp");
    body.append_child(&input)?;

    let status = document.create_element("p")?;
    body.append_child(&status)?;

    let viewer = document.create_element("model-viewer")?;
    viewer.set_attribute("camera-controls", "")?;
    viewer.set_attribute("auto-rotate", "")?;
    viewer.set_attribute("shadow-intensity", "1")?;
    viewer.set_attribute("style", "width:100%;height:500px;background:#eee")?;
    body.append_child(&viewer)?;

    // Default model: generate 00_chijin dynamically (no STEP file shipped).
    match chijin_glb() {
        Ok(glb) => {
            viewer.set_attribute("src", &glb_object_url(&glb)?)?;
            status.set_text_content(Some(&format!(
                "Default model: 00_chijin ({} GLB bytes). Select a .step / .stp to convert.",
                glb.len()
            )));
        }
        Err(e) => status.set_text_content(Some(&format!("chijin generation failed: {e:?}"))),
    }

    // On file selection, convert STEP -> GLB and swap the model.
    let input_cb = input.clone();
    let viewer_cb = viewer.clone();
    let status_cb = status.clone();
    let on_change = Closure::<dyn FnMut()>::new(move || {
        let file = match input_cb.files().and_then(|f| f.get(0)) {
            Some(f) => f,
            None => return,
        };
        let viewer = viewer_cb.clone();
        let status = status_cb.clone();
        status.set_text_content(Some(&format!(
            "Converting {} ({} bytes)…",
            file.name(),
            file.size() as u64
        )));
        wasm_bindgen_futures::spawn_local(async move {
            match convert_file(&file).await.and_then(|glb| {
                let url = glb_object_url(&glb)?;
                Ok((glb.len(), url))
            }) {
                Ok((len, url)) => {
                    if let Some(prev) = viewer.get_attribute("src") {
                        let _ = web_sys::Url::revoke_object_url(&prev);
                    }
                    let _ = viewer.set_attribute("src", &url);
                    status.set_text_content(Some(&format!("Done: {len} GLB bytes.")));
                }
                Err(e) => status.set_text_content(Some(&format!("Conversion error: {e:?}"))),
            }
        });
    });
    input.add_event_listener_with_callback("change", on_change.as_ref().unchecked_ref())?;
    on_change.forget();

    Ok(())
}

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
