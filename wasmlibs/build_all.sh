#!/usr/bin/env bash
set -e

# Pixman build fails using higher versions
EMSDK_VERSION="1.38.37"
#EMSDK_VERSION="latest"

#######################################
# Ensures a repo is checked out.
# Arguments:
#   url: string
#   name: string
# Returns:
#   None
#######################################
ensure_repo() {
    local url name
    local "${@}"

    git -C ${name} pull || git clone ${url} ${name}
}

ensure_emscripten() {
    ensure_repo url='https://github.com/emscripten-core/emsdk.git' name='emsdk'
    pushd 'emsdk'
        ./emsdk install ${EMSDK_VERSION}
        ./emsdk activate ${EMSDK_VERSION}
        source ./emsdk_env.sh
    popd
}

build_libxkbcommon() {
    ensure_repo url='https://gitlab.freedesktop.org/xkeyboard-config/xkeyboard-config.git' name='xkeyboard-config'
    pushd xkeyboard-config
        ./autogen.sh --datarootdir=$(pwd)
        make all install
    popd

    ensure_repo url='https://github.com/xkbcommon/libxkbcommon.git' name='libxkbcommon'
    rm -f libxkbcommon.data libxkbcommon.js libxkbcommon.wasm
    pushd libxkbcommon
        # Latest commit with autotools support
        git checkout e7bb7045b8e7e550eb05c8f5f71ce3d9142d6429
        ./autogen.sh --disable-x11
        emconfigure ./configure --disable-x11
        emmake make clean all
        emcc -s MODULARIZE=1 -s ENVIRONMENT='web' -Oz -mnontrapping-fptoint --llvm-opts 3 --llvm-lto 3 .libs/libxkbcommon.so -o ../libxkbcommon.js -s WASM=1 --preload-file $(pwd)/../xkeyboard-config/X11/xkb@/usr/local/share/X11/xkb -s EXPORTED_RUNTIME_METHODS='["lengthBytesUTF8","stringToUTF8","UTF8ToString","FS"]' -s EXPORTED_FUNCTIONS='["_malloc","_xkb_context_new","_xkb_keymap_new_from_string","_xkb_state_new","_free","_xkb_keymap_get_as_string","_xkb_state_update_key","_xkb_state_update_key","_xkb_state_serialize_mods","_xkb_state_serialize_layout","_xkb_keymap_new_from_names","_xkb_context_include_path_append"]'
        git checkout master
    popd
}

build_libpixman() {
    ensure_repo url='https://gitlab.freedesktop.org/pixman/pixman' name='libpixman'
    rm -f libpixman.js libpixman.wasm
    pushd libpixman
        ./autogen.sh
        emconfigure ./configure CFLAGS=-Os --disable-openmp -disable-loongson-mmi --disable-mmx --disable-sse2 --disable-ssse3 --disable-vmx -disable-arm-simd --disable-arm-neon -disable-arm-iwmmxt --disable-arm-iwmmxt2 --disable-mips-dspr2 --disable-gcc-inline-asm
        emmake make clean all
        emcc -s MODULARIZE=1 -s ENVIRONMENT='web' -Oz -mnontrapping-fptoint --llvm-opts 3 --llvm-lto 3 ./pixman/.libs/libpixman-1.so -o ../libpixman.js -s WASM=1 -s EXPORTED_FUNCTIONS='["_malloc","_free","_pixman_region32_init","_pixman_region32_fini","_pixman_region32_init_rect","_pixman_region32_union","_pixman_region32_intersect","_pixman_region32_union_rect","_pixman_region32_rectangles","_pixman_region32_subtract","_pixman_region32_contains_point","_pixman_region32_copy"]'
    popd
}

build_tinyh264() {
    ensure_repo url="https://github.com/udevbe/tinyh264.git" name="tinyh264"
    rm -f TinyH264.wasm TinyH264.js
    pushd tinyh264/wasm
        rake clean
        rake
        cp TinyH264.wasm TinyH264.js -t ../..
    popd
}

main() {
    ensure_emscripten
    build_libxkbcommon
    build_libpixman
    build_tinyh264
}

main
