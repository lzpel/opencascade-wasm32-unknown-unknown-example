use wasm_bindgen::prelude::*;
use cadrum::Solid;
use std::io::Cursor;

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
