use anchor_lang::prelude::*;
use crate::{
    error::ErrorFactory,
    state::{Config, ForeignEmitter}
};

use wormhole_anchor_sdk::wormhole;

#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct RegisterEmitterParams {
    pub chain: u64,
    pub address: [u8; 32]
}

#[derive(Accounts)]
#[instruction(params: RegisterEmitterParams)]
pub struct RegisterEmitter<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        has_one = owner @ ErrorFactory::OwnerOnly,
        seeds = [Config::SEED_PREFIX],
        bump
    )]
    pub config: Box<Account<'info, Config>>,

    #[account(
        init_if_needed,
        payer = owner,
        seeds = [
            ForeignEmitter::SEED_PREFIX,
            &params.chain.to_le_bytes()[..]
        ],
        bump,
        space = ForeignEmitter::MAXIMUM_SIZE,
    )]
    pub foreign_emitter: Account<'info, ForeignEmitter>,
    pub system_program: Program<'info, System>,
}


impl RegisterEmitter<'_> {
    pub fn register_emitter(
        ctx: Context<RegisterEmitter>,
        params: &RegisterEmitterParams,
    ) -> Result<()> {
        let chain = params.chain;
        let address = params.address;
        // Foreign emitter cannot share the same Wormhole Chain ID as the
        // Solana Wormhole program's. And cannot register a zero address.
        require!(
            chain > 0 && chain != wormhole::CHAIN_ID_SOLANA as u64 as u64 && !address.iter().all(|&x| x == 0),
            ErrorFactory::InvalidForeignEmitter,
        );

        // Save the emitter info into the ForeignEmitter account.
        let emitter = &mut ctx.accounts.foreign_emitter;
        emitter.chain = chain;
        emitter.address = address;

        // Done.
        Ok(())
    }
}