// Empêche l'ouverture d'une fenêtre de console sous Windows en version finale.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    montage_video_lib::run()
}
