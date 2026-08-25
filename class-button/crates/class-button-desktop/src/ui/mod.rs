use makepad_widgets::*;

pub(crate) fn theme_mod(vm: &mut ScriptVm) {
    crate::ui::theme::script_mod(vm);
}

pub(crate) fn primitives_mod(vm: &mut ScriptVm) {
    crate::ui::primitives::script_mod(vm);
}

pub(crate) fn screen_mod(vm: &mut ScriptVm) {
    crate::ui::player_screen::script_mod(vm);
}

mod player_screen;
mod primitives;
mod theme;
