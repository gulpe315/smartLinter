//! SmartLinter Core Library
//!
//! Provides common communication protocols, telemetry data models, diff engines,
//! and local bridge server integration for SmartLinter.

pub mod ai;
pub mod commands;
pub mod deterministic_qa;
pub mod indesign_com;
pub mod language;
pub mod protocol;
pub mod segmenter;
pub mod server;
pub mod tm;
pub mod window_focus;

