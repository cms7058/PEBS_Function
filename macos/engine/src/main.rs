use std::io::{self, Read};
type Err = String;
fn err(message: &str) -> Err { message.into() }
#[allow(dead_code)]
#[path = "../../../backend/src/regression.rs"]
mod regression;
fn main() {
    let mut input = String::new();
    let result = io::stdin().read_to_string(&mut input).map_err(|e|e.to_string())
        .and_then(|_|serde_json::from_str::<regression::Input>(&input).map_err(|e|e.to_string()))
        .and_then(regression::run);
    match result {
        Ok(value) => println!("{}",value),
        Err(error) => { eprintln!("{}",error);std::process::exit(1); }
    }
}
