use anchor_lang::prelude::*;

pub mod actions;
pub use actions::*;

pub mod cat_struct;
pub use cat_struct::*;

pub mod error;
pub use error::*;

pub mod state;
pub use state::*;

pub mod constants;
pub use constants::*;

pub mod utils;
pub use utils::*;

declare_id!("Dw4ev4agC4ZYxi1HUJtruS4xWij5iMQxijLX4J7coC4q");

#[program]
pub mod cat_sol20 {
    use super::*;
 
    pub fn initialize( ctx: Context<Initialize>, params: InitializeParams) -> Result<()> {
        Initialize::initialize(ctx, &params)
    }

    pub fn mint_tokens(ctx: Context<MintTokens>, amount: u64) -> Result<()> {
        MintTokens::mint_tokens(ctx, amount)
    }

    pub fn transfer_ownership(ctx: Context<TransferOwnership>) -> Result<()> {
        TransferOwnership::transfer_ownership(ctx)
    }

    pub fn register_emitter( ctx: Context<RegisterEmitter>, params: RegisterEmitterParams) -> Result<()> {
        RegisterEmitter::register_emitter(ctx, &params)
    }

    pub fn bridge_out( ctx: Context<BridgeOut>, params: BridgeOutParams) -> Result<()> {
        BridgeOut::bridge_out(ctx, params)
    }

    pub fn bridge_in(ctx: Context<BridgeIn>, params: BridgeInParams) -> Result<()> {
        BridgeIn::bridge_in(ctx, params)
    }
}
