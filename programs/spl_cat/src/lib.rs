use anchor_lang::prelude::*;
use anchor_spl::token::{burn, mint_to, Burn, MintTo};

pub use cat_struct::*;
pub use context::*;
pub use error::*;
pub use state::*;

pub mod cat_struct;
pub mod context;
pub mod error;
pub mod state;

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod spl_cat {
    use super::*;
    use anchor_lang::solana_program;
    use wormhole_anchor_sdk::wormhole;

    pub fn initialize(ctx: Context<Initialize>, _decimals: u8, initial_supply: u64) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.owner = ctx.accounts.owner.key();

        {
            let wormhole = &mut config.wormhole;
            wormhole.bridge = ctx.accounts.wormhole_bridge.key();
            wormhole.fee_collector = ctx.accounts.wormhole_fee_collector.key();
            wormhole.sequence = ctx.accounts.wormhole_sequence.key();
        }

        // Set default values for posting Wormhole messages.
        //
        // Zero means no batching.
        config.batch_id = 0;

        // Anchor IDL default coder cannot handle wormhole::Finality enum,
        // so this value is stored as u8.
        config.finality = wormhole::Finality::Confirmed as u8;

        // Mint the initial supply of tokens to the program's owner.
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_accounts = MintTo {
            mint: ctx.accounts.token_mint.to_account_info(),
            to: ctx.accounts.token_account.to_account_info(),
            authority: ctx.accounts.owner.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);

        mint_to(cpi_ctx, initial_supply)?;

        Ok(())
    }


    pub fn register_emitter(
        ctx: Context<RegisterEmitter>,
        chain: u16,
        address: [u8; 32],
    ) -> Result<()> {
        // Foreign emitter cannot share the same Wormhole Chain ID as the
        // Solana Wormhole program's. And cannot register a zero address.
        require!(
            chain > 0 && chain != wormhole::CHAIN_ID_SOLANA && !address.iter().all(|&x| x == 0),
            ErrorFactory::InvalidForeignEmitter,
        );

        // Save the emitter info into the ForeignEmitter account.
        let emitter = &mut ctx.accounts.foreign_emitter;
        emitter.chain = chain;
        emitter.address = address;

        // Done.
        Ok(())
    }

    pub fn bridge_out(
        ctx: Context<BridgeOut>,
        amount: u64,
        recipient_chain: u16,
        recipient: [u8; 32],
    ) -> Result<()> {
        // If Wormhole requires a fee before posting a message, we need to
        // transfer lamports to the fee collector. Otherwise
        // `wormhole::post_message` will fail.
        let fee = ctx.accounts.wormhole_bridge.fee();
        if fee > 0 {
            solana_program::program::invoke(
                &solana_program::system_instruction::transfer(
                    &ctx.accounts.owner.key(),
                    &ctx.accounts.wormhole_fee_collector.key(),
                    fee,
                ),
                &ctx.accounts.to_account_infos(),
            )?;
        }

        // Burn the tokens
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_accounts = Burn {
            mint: ctx.accounts.token_mint.to_account_info(),
            from: ctx.accounts.token_account.to_account_info(),
            authority: ctx.accounts.owner.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);

        burn(cpi_ctx, amount)?;

        // Invoke `wormhole::post_message`.
        //
        // `wormhole::post_message` requires two signers: one for the emitter
        // and another for the wormhole message data. Both of these accounts
        // are owned by this program.
    
        let wormhole_emitter = &ctx.accounts.wormhole_emitter;
        let config = &ctx.accounts.config;

        let payload = CrossChainPayload {
            amount,
            token_address: ctx.accounts.token_account.key().to_bytes(),
            token_chain: wormhole::CHAIN_ID_SOLANA,
            to_address: recipient,
            to_chain: recipient_chain,
        };

        let cat_sol_struct = CATSOLStructs::CrossChainPayload { payload };
        let mut encoded_payload: Vec<u8> = Vec::new();
        cat_sol_struct.serialize(&mut encoded_payload)?;


        wormhole::post_message(
            CpiContext::new_with_signer(
                ctx.accounts.wormhole_program.to_account_info(),
                wormhole::PostMessage {
                    config: ctx.accounts.wormhole_bridge.to_account_info(),
                    message: ctx.accounts.wormhole_message.to_account_info(),
                    emitter: wormhole_emitter.to_account_info(),
                    sequence: ctx.accounts.wormhole_sequence.to_account_info(),
                    payer: ctx.accounts.owner.to_account_info(),
                    fee_collector: ctx.accounts.wormhole_fee_collector.to_account_info(),
                    clock: ctx.accounts.clock.to_account_info(),
                    rent: ctx.accounts.rent.to_account_info(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                },
                &[
                    &[
                        SEED_PREFIX_SENT,
                        &ctx.accounts.wormhole_sequence.next_value().to_le_bytes()[..],
                        &[*ctx
                            .bumps
                            .get("wormhole_message")
                            .ok_or(ErrorFactory::BumpNotFound)?],
                    ],
                    &[wormhole::SEED_PREFIX_EMITTER, &[wormhole_emitter.bump]],
                ],
            ),
            config.batch_id,
            encoded_payload,
            config.finality.into(),
        )?;

        // Done.
        Ok(())
    }


    pub fn bridge_in(ctx: Context<BridgeIn>, vaa_hash: [u8; 32]) -> Result<()> {
        let posted_message = &ctx.accounts.posted;

        if let CATSOLStructs::CrossChainPayload { payload } = posted_message.data() {
            
            let cpi_program = ctx.accounts.token_program.to_account_info();
            let cpi_accounts = MintTo {
                mint: ctx.accounts.token_mint.to_account_info(),
                to: ctx.accounts.token_account.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            };
            let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);

            mint_to(cpi_ctx, payload.amount)?;

            let mut serialized_payload: Vec<u8> = Vec::new();
            CATSOLStructs::CrossChainPayload { payload: payload.clone() }
                .serialize(&mut serialized_payload)?;

            // Save batch ID, keccak256 hash and message payload.
            let received = &mut ctx.accounts.received;
            received.batch_id = posted_message.batch_id();
            received.wormhole_message_hash = vaa_hash;
            received.payload = serialized_payload;

            // Done
            Ok(())
        } else {
            Err(ErrorFactory::InvalidMessage.into())
        }
    }
}
