mod auth;
mod config;
mod host;
mod proxy;
mod update;
mod web;

use std::io::IsTerminal;
use std::path::PathBuf;
use std::time::Duration;

use anyhow::{bail, Context, Result};
use clap::{Args, Parser, Subcommand};
use config::Config;
use serde_json::json;

#[derive(Parser)]
#[command(
    name = "opencode-tether",
    version,
    about = "Host, proxy, and remote access for opencode",
    long_about = "opencode-tether is an unofficial, hobby-project remote interface for opencode.\n\n\
                  It can serve the opencode-tether web app on one port, launch `opencode serve` underneath,\n\
                  proxy the opencode API (including SSE and WebSockets), and protect it with a single login.\n\
                  It also connects to existing opencode servers as a client."
)]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,
}

#[derive(Subcommand)]
enum Commands {
    /// Create a host configuration with a username and password.
    Init(InitArgs),
    /// Run the host server and proxy the configured opencode command.
    Serve(ServeArgs),
    /// Show the health of a running host.
    Status(StatusArgs),
    /// Diagnose configuration, opencode, ports, and assets.
    Doctor(DoctorArgs),
    /// Check for and install a newer release of the host binary.
    Update(UpdateArgs),
    /// Print or inspect the configuration.
    Config(ConfigArgs),
    /// Install or remove a systemd service.
    Service(ServiceArgs),
    /// Print version information.
    Version,
}

#[derive(Args)]
struct InitArgs {
    /// Configuration file to write.
    #[arg(long, env = "OPENCODE_TETHER_CONFIG")]
    config: Option<PathBuf>,
    /// Login username.
    #[arg(long, default_value = "opencode")]
    username: String,
    /// Login password. Prompted for when omitted.
    #[arg(long)]
    password: Option<String>,
    /// Address to listen on.
    #[arg(long, default_value = config::DEFAULT_BIND)]
    bind: String,
    /// Local port used by the opencode upstream.
    #[arg(long, default_value_t = config::DEFAULT_UPSTREAM_PORT)]
    upstream_port: u16,
    /// Command used to start opencode. Supports {port}, {hostname}, {bind}, and {url}.
    #[arg(long, default_value = config::DEFAULT_COMMAND)]
    command: String,
    /// Overwrite an existing configuration.
    #[arg(long)]
    force: bool,
    /// Do not prompt; require --password.
    #[arg(long)]
    non_interactive: bool,
    /// Print the configuration instead of writing it.
    #[arg(long)]
    print_only: bool,
}

#[derive(Args)]
struct ServeArgs {
    #[arg(long, env = "OPENCODE_TETHER_CONFIG")]
    config: Option<PathBuf>,
}

#[derive(Args)]
struct StatusArgs {
    #[arg(long, env = "OPENCODE_TETHER_CONFIG")]
    config: Option<PathBuf>,
    #[arg(long)]
    json: bool,
}

#[derive(Args)]
struct DoctorArgs {
    #[arg(long, env = "OPENCODE_TETHER_CONFIG")]
    config: Option<PathBuf>,
}

#[derive(Args)]
struct UpdateArgs {
    /// Only check for an update.
    #[arg(long)]
    check: bool,
    /// Install even when the version is not newer or no checksum exists.
    #[arg(long)]
    force: bool,
    /// GitHub repository in owner/name form.
    #[arg(long, default_value = config::DEFAULT_REPO)]
    repo: String,
}

#[derive(Args)]
struct ConfigArgs {
    #[command(subcommand)]
    command: ConfigCommand,
}

#[derive(Subcommand)]
enum ConfigCommand {
    /// Print the configuration path.
    Path {
        #[arg(long, env = "OPENCODE_TETHER_CONFIG")]
        config: Option<PathBuf>,
    },
    /// Print the configuration with secrets redacted.
    Show {
        #[arg(long, env = "OPENCODE_TETHER_CONFIG")]
        config: Option<PathBuf>,
    },
}

#[derive(Args)]
struct ServiceArgs {
    #[command(subcommand)]
    command: ServiceCommand,
}

#[derive(Subcommand)]
enum ServiceCommand {
    /// Install a systemd unit.
    Install {
        #[arg(long)]
        user: bool,
        #[arg(long)]
        system: bool,
        #[arg(long)]
        force: bool,
        #[arg(long, env = "OPENCODE_TETHER_CONFIG")]
        config: Option<PathBuf>,
    },
    /// Remove an installed systemd unit.
    Uninstall {
        #[arg(long)]
        user: bool,
        #[arg(long)]
        system: bool,
    },
}

#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        eprintln!("error: {error:#}");
        std::process::exit(1);
    }
}

async fn run() -> Result<()> {
    init_tracing();
    let cli = Cli::parse();
    match cli.command.unwrap_or(Commands::Serve(ServeArgs { config: None })) {
        Commands::Init(args) => init(args),
        Commands::Serve(args) => serve(args).await,
        Commands::Status(args) => status(args).await,
        Commands::Doctor(args) => doctor(args).await,
        Commands::Update(args) => update::run(&args.repo, args.check, args.force).await,
        Commands::Config(args) => config_command(args),
        Commands::Service(args) => service(args),
        Commands::Version => {
            println!("opencode-tether {}", env!("CARGO_PKG_VERSION"));
            println!("unofficial hobby project · https://github.com/{}", config::DEFAULT_REPO);
            Ok(())
        }
    }
}

fn init_tracing() {
    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("opencode_tether=info,info"));
    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .try_init();
}

fn init(args: InitArgs) -> Result<()> {
    let path = args.config.unwrap_or_else(config::default_config_path);
    if path.exists() && !args.force && !args.print_only {
        bail!(
            "{} already exists; use --force to replace it or edit it directly",
            path.display()
        );
    }
    let password = match args.password {
        Some(password) => password,
        None => {
            if args.non_interactive || !std::io::stdin().is_terminal() {
                bail!("--password is required in non-interactive mode");
            }
            let first = rpassword::prompt_password("Password: ")?;
            let second = rpassword::prompt_password("Confirm password: ")?;
            if first != second {
                bail!("passwords do not match");
            }
            first
        }
    };
    if password.len() < 4 {
        bail!("password must be at least 4 characters");
    }
    let mut config = Config::new(&args.username, &password)?;
    config.server.bind = args.bind;
    config.opencode.port = args.upstream_port;
    config.opencode.command = args.command;

    if args.print_only {
        println!("{}", toml::to_string_pretty(&config)?);
        return Ok(());
    }
    config.save(&path)?;
    println!("wrote {}", path.display());
    println!("username: {}", config.server.username);
    println!("bind:     {}", config.server.bind);
    println!("upstream: {} (started with `{}`)", config.upstream_base_url(), config.opencode.command);
    println!();
    println!("Next:");
    println!("  sudo opencode-tether serve --config {}", path.display());
    println!("  open http://127.0.0.1:{}", port_of(&config.server.bind).unwrap_or(4096));
    println!();
    println!("Install a service with: opencode-tether service install --user");
    Ok(())
}

async fn serve(args: ServeArgs) -> Result<()> {
    let path = args.config.unwrap_or_else(config::default_config_path);
    let config = Config::load(&path)?;
    host::run(config, path).await
}

async fn status(args: StatusArgs) -> Result<()> {
    let path = args.config.unwrap_or_else(config::default_config_path);
    let config = Config::load(&path)?;
    let port = port_of(&config.server.bind).unwrap_or(4096);
    let base = format!("http://127.0.0.1:{port}");
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(6))
        .no_proxy()
        .build()?;
    let info = client
        .get(format!("{base}/api/tether/info"))
        .send()
        .await
        .with_context(|| format!("host is not answering at {base}"))?;
    let status = info.status();
    let body: serde_json::Value = info.json().await.unwrap_or_default();
    if args.json {
        println!("{}", serde_json::to_string_pretty(&body)?);
        return Ok(());
    }
    println!("host:     {base} (HTTP {status})");
    println!("config:   {}", path.display());
    println!("username: {}", config.server.username);
    println!("tether:   {}", body.get("version").and_then(|v| v.as_str()).unwrap_or("?"));
    let upstream = &body["upstream"];
    println!(
        "opencode: {} (healthy: {})",
        upstream.get("version").and_then(|v| v.as_str()).unwrap_or("unknown"),
        upstream.get("healthy").and_then(|v| v.as_bool()).unwrap_or(false)
    );
    if let Some(error) = upstream.get("error").and_then(|v| v.as_str()) {
        println!("error:    {error}");
    }
    Ok(())
}

async fn doctor(args: DoctorArgs) -> Result<()> {
    let path = args.config.unwrap_or_else(config::default_config_path);
    println!("opencode-tether doctor\n");
    let mut problems = 0;
    check_item("config file", path.exists(), &path.display().to_string());
    if !path.exists() {
        println!("\nRun `opencode-tether init` to create a configuration.");
        return Ok(());
    }
    let config = Config::load(&path)?;
    let valid = config.validate();
    let valid_ok = valid.is_ok();
    let valid_detail = match &valid {
        Ok(()) => "valid".to_string(),
        Err(error) => error.to_string(),
    };
    check_item("configuration", valid_ok, &valid_detail);
    if !valid_ok {
        problems += 1;
    }

    let opencode = std::process::Command::new("opencode").arg("--version").output();
    match &opencode {
        Ok(output) if output.status.success() => {
            let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
            check_item("opencode", true, &version);
        }
        _ => {
            check_item("opencode", false, "not found on PATH (set opencode.command or install it)");
            problems += 1;
        }
    }

    let port = port_of(&config.server.bind).unwrap_or(4096);
    let bind_check = std::net::TcpListener::bind(&config.server.bind);
    match bind_check {
        Ok(listener) => {
            drop(listener);
            check_item("listen address", true, &config.server.bind);
        }
        Err(error) => {
            let maybe_running = std::net::TcpStream::connect(("127.0.0.1", port)).is_ok();
            let detail = if maybe_running {
                "in use (host may already be running)".to_string()
            } else {
                error.to_string()
            };
            check_item("listen address", maybe_running, &detail);
        }
    }

    let client = reqwest::Client::builder().timeout(Duration::from_secs(4)).no_proxy().build()?;
    let upstream = client
        .get(format!("{}/global/health", config.upstream_base_url()))
        .send()
        .await;
    match &upstream {
        Ok(response) if response.status().is_success() || response.status() == 401 => {
            check_item("opencode upstream", true, &config.upstream_base_url());
        }
        _ => {
            check_item("opencode upstream", false, &config.upstream_base_url());
            problems += 1;
        }
    }

    let web = web::WebAssets::new(config.web.root.clone());
    match web.read_index() {
        Some(asset) => check_item("web app", true, &format!("{} bytes embedded", asset.bytes.len())),
        None => {
            check_item("web app", false, "missing; rebuild with npm --prefix apps/tether run build");
            problems += 1;
        }
    }

    println!();
    if problems == 0 {
        println!("Everything looks good.");
    } else {
        println!("{problems} item(s) need attention.");
    }
    Ok(())
}

fn check_item(name: &str, ok: bool, detail: &str) {
    println!("[{}] {name}: {detail}", if ok { "ok" } else { "!!" });
}

fn config_command(args: ConfigArgs) -> Result<()> {
    match args.command {
        ConfigCommand::Path { config } => {
            println!("{}", config.unwrap_or_else(config::default_config_path).display());
            Ok(())
        }
        ConfigCommand::Show { config } => {
            let path = config.unwrap_or_else(config::default_config_path);
            let config = Config::load(&path)?;
            println!("{}", serde_json::to_string_pretty(&config.redacted_json())?);
            Ok(())
        }
    }
}

fn service(args: ServiceArgs) -> Result<()> {
    match args.command {
        ServiceCommand::Install { user, system, force, config } => {
            let system = system || (!user && home_is_root());
            let config_path = config.unwrap_or_else(config::default_config_path);
            if !config_path.exists() {
                bail!("{} does not exist; run `opencode-tether init` first", config_path.display());
            }
            let exe = std::env::current_exe()?;
            let unit_path = if system {
                PathBuf::from("/etc/systemd/system/opencode-tether.service")
            } else {
                dirs::config_dir()
                    .context("could not locate the user config directory")?
                    .join("systemd/user/opencode-tether.service")
            };
            if unit_path.exists() && !force {
                bail!("{} already exists; use --force to replace it", unit_path.display());
            }
            if let Some(parent) = unit_path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let run_user = if system {
                std::env::var("SUDO_USER").ok().filter(|user| user != "root")
            } else {
                None
            };
            let mut unit = String::new();
            unit.push_str("[Unit]\nDescription=opencode-tether host\nAfter=network-online.target\nWants=network-online.target\n\n");
            unit.push_str("[Service]\nType=simple\n");
            if let Some(user) = &run_user {
                unit.push_str(&format!("User={user}\n"));
                unit.push_str(&format!("Environment=HOME=/home/{user}\n"));
            }
            unit.push_str(&format!(
                "ExecStart={} serve --config {}\n",
                quote(&exe.display().to_string()),
                quote(&config_path.display().to_string())
            ));
            unit.push_str("Restart=on-failure\nRestartSec=3\n");
            unit.push_str("NoNewPrivileges=false\n\n");
            unit.push_str(if system {
                "[Install]\nWantedBy=multi-user.target\n"
            } else {
                "[Install]\nWantedBy=default.target\n"
            });
            std::fs::write(&unit_path, unit)?;
            println!("wrote {}", unit_path.display());
            if system {
                println!("sudo systemctl daemon-reload");
                println!("sudo systemctl enable --now opencode-tether");
            } else {
                println!("systemctl --user daemon-reload");
                println!("systemctl --user enable --now opencode-tether");
                println!("loginctl enable-linger $USER   # keep it running after logout");
            }
            Ok(())
        }
        ServiceCommand::Uninstall { user, system } => {
            let system = system || (!user && home_is_root());
            let unit_path = if system {
                PathBuf::from("/etc/systemd/system/opencode-tether.service")
            } else {
                dirs::config_dir()
                    .context("could not locate the user config directory")?
                    .join("systemd/user/opencode-tether.service")
            };
            if unit_path.exists() {
                std::fs::remove_file(&unit_path)?;
                println!("removed {}", unit_path.display());
            } else {
                println!("{} does not exist", unit_path.display());
            }
            if system {
                println!("sudo systemctl daemon-reload");
            } else {
                println!("systemctl --user daemon-reload");
            }
            Ok(())
        }
    }
}

fn quote(value: &str) -> String {
    if value.contains(' ') {
        format!("\"{}\"", value.replace('"', "\\\""))
    } else {
        value.to_string()
    }
}

fn home_is_root() -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        std::fs::metadata("/proc/self").map(|meta| meta.uid() == 0).unwrap_or(false)
    }
    #[cfg(not(unix))]
    {
        false
    }
}

fn port_of(bind: &str) -> Option<u16> {
    bind.parse::<std::net::SocketAddr>().ok().map(|addr| addr.port())
}

#[allow(dead_code)]
fn print_json(value: &serde_json::Value) -> Result<()> {
    println!("{}", serde_json::to_string_pretty(value)?);
    Ok(())
}

#[allow(dead_code)]
fn placeholder() -> serde_json::Value {
    json!({})
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_port() {
        assert_eq!(port_of("0.0.0.0:4096"), Some(4096));
        assert_eq!(port_of("[::]:4096"), Some(4096));
    }

    #[test]
    fn quotes_paths() {
        assert_eq!(quote("/usr/bin/opencode-tether"), "/usr/bin/opencode-tether");
        assert_eq!(quote("/home/a b/bin"), "\"/home/a b/bin\"");
    }
}
