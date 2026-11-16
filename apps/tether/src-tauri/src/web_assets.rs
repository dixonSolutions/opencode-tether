//! Android UI content is separate from the JNI library, so signed content can reload in-process.
use std::{
    borrow::Cow,
    collections::BTreeMap,
    sync::{OnceLock, RwLock},
};
use tauri::{
    utils::assets::{AssetKey, AssetsIter, CspHash},
    Assets, Runtime,
};

static WEB: OnceLock<RwLock<BTreeMap<String, Vec<u8>>>> = OnceLock::new();
fn web() -> &'static RwLock<BTreeMap<String, Vec<u8>>> {
    WEB.get_or_init(Default::default)
}

pub struct WebAssets;
impl<R: Runtime> Assets<R> for WebAssets {
    fn get(&self, key: &AssetKey) -> Option<Cow<'_, [u8]>> {
        web()
            .read()
            .ok()?
            .get(key.as_ref().trim_start_matches('/'))
            .cloned()
            .map(Cow::Owned)
    }
    fn iter(&self) -> Box<AssetsIter<'_>> {
        Box::new(std::iter::empty())
    }
    fn csp_hashes(&self, _: &AssetKey) -> Box<dyn Iterator<Item = CspHash<'_>> + '_> {
        Box::new(std::iter::empty())
    }
}

#[no_mangle]
pub extern "system" fn Java_ai_opencode_tether_MainActivity_nativeSetWebRoot(
    mut env: jni::JNIEnv,
    _: jni::objects::JObject,
    root: jni::objects::JString,
) -> jni::sys::jboolean {
    fn load(
        dir: &std::path::Path,
        root: &std::path::Path,
        map: &mut BTreeMap<String, Vec<u8>>,
    ) -> std::io::Result<()> {
        for entry in std::fs::read_dir(dir)? {
            let entry = entry?;
            if entry.file_type()?.is_dir() {
                load(&entry.path(), root, map)?;
            } else if entry.file_type()?.is_file() {
                let path = entry.path();
                let key = path
                    .strip_prefix(root)
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/");
                map.insert(key, std::fs::read(path)?);
            }
        }
        Ok(())
    }
    let result = (|| -> Option<()> {
        let path: String = env.get_string(&root).ok()?.into();
        let root = std::path::Path::new(&path);
        let mut map = BTreeMap::new();
        load(root, root, &mut map).ok()?;
        if !map.contains_key("index.html") {
            return None;
        }
        *web().write().ok()? = map;
        Some(())
    })();
    u8::from(result.is_some())
}
