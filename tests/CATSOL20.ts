import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { CatSol20 } from "../target/types/cat_sol20";
import { TOKEN_METADATA_PROGRAM_ID } from "@certusone/wormhole-sdk/lib/cjs/solana";
import { deriveAddress } from "@certusone/wormhole-sdk/lib/cjs/solana";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createSetAuthorityInstruction,
  AuthorityType
} from "@solana/spl-token"
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import {
  getEmitterAddressEth,
  getEmitterAddressSolana,
  tryNativeToUint8Array,
  tryHexToNativeString,
  parseSequenceFromLogSolana,
  postVaaSolanaWithRetry,
  getSignedVAAHash,
  CHAINS,
  parseVaa,
  tryUint8ArrayToNative,
} from '@certusone/wormhole-sdk';
import { getWormholeCpiAccounts, getPostMessageCpiAccounts } from "@certusone/wormhole-sdk/lib/cjs/solana";
import { getProgramSequenceTracker, derivePostedVaaKey } from "@certusone/wormhole-sdk/lib/cjs/solana/wormhole";
import base58 from "bs58";
import axios from "axios";
import fs from "fs";


describe("cat_sol20", () => {
  const provider = anchor.AnchorProvider.env();
  // Configure the client to use the local cluster.
  anchor.setProvider(provider);

  const program = anchor.workspace.CatSol20 as Program<CatSol20>;
  const SPL_CAT_PID = program.programId;
  const CORE_BRIDGE_PID = "Bridge1p5gheXUvJ6jGWGeCsgPKgnE3YgdGKRVCMY9o";

  // The Owner of the token mint
  const KEYPAIR = anchor.web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync('/home/ace/.config/solana/id.json').toString())));

  // The new owner of the token mint
  const newOwner = anchor.web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync('/home/ace/.config/solana/id2.json').toString())));

  // The Token Mint we will use for testing
  const tokenMintPDA = PublicKey.findProgramAddressSync([Buffer.from("spl_cat_token")], SPL_CAT_PID)[0];

  // The Token Metadata PDA
  const tokenMetadataPDA = PublicKey.findProgramAddressSync([Buffer.from("metadata"), TOKEN_METADATA_PROGRAM_ID.toBuffer(), tokenMintPDA.toBuffer()], TOKEN_METADATA_PROGRAM_ID)[0];

  // The Bridge out VAA will be saved here and used for Bridge In
  let VAA: any = null;

  it("Fund New owner with some SOL", async () => {
    try {
      const tx = await provider.connection.requestAirdrop(newOwner.publicKey, 10 * LAMPORTS_PER_SOL);
      console.log("Your transaction signature", tx);
    } catch (e: any) {
      console.log(e);
    }
  });

  it("Can Initialize and Create a Mint", async () => {
    try {
      const [configAcc, configBmp] = PublicKey.findProgramAddressSync([
        Buffer.from("config")
      ], SPL_CAT_PID);

      // Initial Sequence is 1
      const initial_sequence = Buffer.alloc(8);
      initial_sequence.writeBigUint64LE(BigInt(1));

      const wormhole = getWormholeCpiAccounts(
        CORE_BRIDGE_PID,
        KEYPAIR.publicKey,
        SPL_CAT_PID,
        deriveAddress([Buffer.from("sent"), initial_sequence], SPL_CAT_PID)
      );

      let max_supply = new anchor.BN("10000000000000000000");
      // let max_supply = new anchor.BN("0");

      const tx = await program.methods.initialize({
        decimals: 9,
        maxSupply: max_supply,
        name: "Cat Token",
        symbol: "CAT",
        uri: "",
      }).accounts({
        owner: KEYPAIR.publicKey,
        config: configAcc,
        tokenMint: tokenMintPDA,
        metadataAccount: tokenMetadataPDA,
        tokenProgram: TOKEN_PROGRAM_ID,
        metadataProgram: TOKEN_METADATA_PROGRAM_ID,
        wormholeProgram: CORE_BRIDGE_PID,
        wormholeBridge: wormhole.bridge,
        wormholeEmitter: wormhole.emitter,
        wormholeSequence: wormhole.sequence,
        wormholeFeeCollector: wormhole.feeCollector,
        wormholeMessage: wormhole.message,
        clock: wormhole.clock,
        rent: wormhole.rent,
        systemProgram: anchor.web3.SystemProgram.programId,
      }).signers([KEYPAIR]).rpc({ skipPreflight: true });
      console.log("Your transaction signature", tx);
    } catch (e: any) {
      console.log(e);
    }
  });


  it("Can Transfer Config Ownership", async () => {
    try {

      const [configAcc, configBmp] = PublicKey.findProgramAddressSync([
        Buffer.from("config")
      ], SPL_CAT_PID);

      const tx = await program.methods.transferOwnership().accounts({
        owner: KEYPAIR.publicKey,
        newOwner: newOwner.publicKey,
        config: configAcc,
      }).signers([KEYPAIR, newOwner]).rpc();
      console.log("Your transaction signature", tx);

    } catch (e: any) {
      console.log(e);
    }
  })

  it("Can Transfer Mint Authority", async () => {
    try {

      let transaction = new anchor.web3.Transaction();
      transaction.add(
        createSetAuthorityInstruction(
          tokenMintPDA,
          KEYPAIR.publicKey,
          AuthorityType.MintTokens,
          newOwner.publicKey
        )
      );
      const tx = await anchor.web3.sendAndConfirmTransaction(provider.connection, transaction, [KEYPAIR]);
      console.log("Your transaction signature", tx);


    } catch (e: any) {
      console.log(e);
    }
  })


  it("Can Mint Tokens", async () => {
    try {

      const [configAcc, configBmp] = PublicKey.findProgramAddressSync([
        Buffer.from("config")
      ], SPL_CAT_PID);

      const tokenUserATA = getAssociatedTokenAddressSync(
        tokenMintPDA,
        newOwner.publicKey,
      );

      let amount = new anchor.BN("100000000000000000");
      const tx = await program.methods.mintTokens(amount).accounts({
        owner: newOwner.publicKey,
        ataAuthority: newOwner.publicKey,
        config: configAcc,
        tokenMint: tokenMintPDA,
        tokenUserAta: tokenUserATA,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      }).signers([newOwner]).rpc({ skipPreflight: true });
      console.log("Your transaction signature", tx);
    } catch (e: any) {
      console.log(e);
    }
  })

  it("Can Register a chain", async () => {
    try {
      // Registering Ethereum 
      const foreignChainId = Buffer.alloc(2);
      foreignChainId.writeUInt16LE(CHAINS.ethereum);

      const [emitterAcc, emitterBmp] = PublicKey.findProgramAddressSync([
        Buffer.from("foreign_emitter"),
        foreignChainId,
      ], SPL_CAT_PID)

      // Replace this with the Eth Contract
      const ethContractAddress = "0x970e8f18ebfEa0B08810f33a5A40438b9530FBCF";
      let targetEmitterAddress: string | number[] = getEmitterAddressEth(ethContractAddress);
      targetEmitterAddress = Array.from(Buffer.from(targetEmitterAddress, "hex"))

      const [configAcc, configBmp] = PublicKey.findProgramAddressSync([
        Buffer.from("config")
      ], SPL_CAT_PID);

      const tx = await program.methods.registerEmitter({
        chain: CHAINS.ethereum,
        address: targetEmitterAddress,
      }).accounts({
        owner: newOwner.publicKey,
        config: configAcc,
        foreignEmitter: emitterAcc,
        systemProgram: anchor.web3.SystemProgram.programId
      })
        .signers([newOwner])
        .rpc();

      console.log("Your transaction signature", tx);
    } catch (e: any) {

      console.log(e);
    }
  })

  it("Bridge Out", async () => {

    try {

      const [configAcc, configBmp] = PublicKey.findProgramAddressSync([
        Buffer.from("config")
      ], SPL_CAT_PID);

      // Make Sure this acc is initialized and has tokens
      const tokenUserATA = getAssociatedTokenAddressSync(
        tokenMintPDA,
        newOwner.publicKey,
      );

      const foreignChainId = Buffer.alloc(2);
      foreignChainId.writeUInt16LE(CHAINS.ethereum);

      const [emitterAcc, emitterBmp] = PublicKey.findProgramAddressSync([
        Buffer.from("foreign_emitter"),
        foreignChainId,
      ], SPL_CAT_PID)

      // get sequence
      const SequenceTracker = await getProgramSequenceTracker(provider.connection, SPL_CAT_PID, CORE_BRIDGE_PID)
        .then((tracker) =>
          deriveAddress(
            [
              Buffer.from("sent"),
              (() => {
                const buf = Buffer.alloc(8);
                buf.writeBigUInt64LE(tracker.sequence + BigInt(1));
                return buf;
              })(),
            ],
            SPL_CAT_PID
          )
        );

      const wormholeAccounts = getPostMessageCpiAccounts(
        SPL_CAT_PID,
        CORE_BRIDGE_PID,
        newOwner.publicKey,
        SequenceTracker
      );

      // User's Ethereum address
      let userEthAddress = "0x90F8bf6A479f320ead074411a4B0e7944Ea8c9C1";
      let recipient = Array.from(tryNativeToUint8Array(userEthAddress, "ethereum"));

      // Parameters
      let amount = new anchor.BN("10000000000000000");
      let recipientChain = 2;
      const tx = await program.methods.bridgeOut({
        amount,
        recipientChain,
        recipient,
      }).accounts({
        owner: newOwner.publicKey,
        ataAuthority: newOwner.publicKey,
        // Token Stuff
        tokenUserAta: tokenUserATA,
        tokenMint: tokenMintPDA,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        // Wormhole Stuff
        wormholeProgram: CORE_BRIDGE_PID,
        foreignEmitter: emitterAcc,
        config: configAcc,
        ...wormholeAccounts,
      }).signers([newOwner]).rpc();

      console.log("Your transaction signature", tx);
      await new Promise((r) => setTimeout(r, 3000)); // Wait for tx to be confirmed

      const confirmedTx = await provider.connection.getTransaction(tx, { commitment: "confirmed", maxSupportedTransactionVersion: 2 });

      const seq = parseSequenceFromLogSolana(confirmedTx)
      const emitterAddr = getEmitterAddressSolana(SPL_CAT_PID.toString()); //same as whDerivedEmitter

      console.log("Sequence: ", seq);
      console.log("Emitter Address: ", emitterAddr);

      await new Promise((r) => setTimeout(r, 3000)); // Wait for guardian to pick up message
      const restAddress = "http://localhost:7071"

      console.log(
        "Searching for: ",
        `${restAddress}/v1/signed_vaa/1/${emitterAddr}/${seq}`
      );

      const vaaBytes = await axios.get(
        `${restAddress}/v1/signed_vaa/1/${emitterAddr}/${seq}`
      );
      VAA = vaaBytes.data.vaaBytes;
      console.log("VAA Bytes: ", vaaBytes.data);

    } catch (e: any) {
      console.log(e);
    }
  });

  it("Bridge In", async () => {
    try {
      await postVaaSolanaWithRetry(
        provider.connection,
        async (tx) => {
          tx.partialSign(newOwner);
          return tx;
        },
        CORE_BRIDGE_PID,
        newOwner.publicKey.toString(),
        Buffer.from(VAA, "base64"),
        10
      );

      const parsedVAA = parseVaa(Buffer.from(VAA, 'base64'));
      const payload = getParsedPayload(parsedVAA.payload);

      const postedVAAKey = derivePostedVaaKey(CORE_BRIDGE_PID, parsedVAA.hash);
      const recievedKey = PublicKey.findProgramAddressSync(
        [
          Buffer.from("received"),
          (() => {
            const buf = Buffer.alloc(10);
            buf.writeUInt16LE(parsedVAA.emitterChain, 0);
            buf.writeBigInt64LE(parsedVAA.sequence, 2);
            return buf;
          })(),
        ], SPL_CAT_PID)[0];


      const [configAcc, configBmp] = PublicKey.findProgramAddressSync([
        Buffer.from("config")
      ], SPL_CAT_PID);

      const tokenUserATA = getAssociatedTokenAddressSync(
        tokenMintPDA,
        payload.toAddress,
      );

      const foreignChainId = Buffer.alloc(2);
      foreignChainId.writeUInt16LE(payload.tokenChain);

      const [emitterAcc, emitterBmp] = PublicKey.findProgramAddressSync([
        Buffer.from("foreign_emitter"),
        foreignChainId,
      ], SPL_CAT_PID)

      const tx = await program.methods.bridgeIn(Array.from(parsedVAA.hash)).accounts({
        owner: newOwner.publicKey,
        ataAuthority: payload.toAddress,
        tokenUserAta: tokenUserATA,
        tokenMint: tokenMintPDA,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        wormholeProgram: CORE_BRIDGE_PID,
        foreignEmitter: emitterAcc,
        posted: postedVAAKey,
        received: recievedKey,
        config: configAcc,
        systemProgram: anchor.web3.SystemProgram.programId,
      }).signers([newOwner]).rpc({ skipPreflight: true });

      console.log("Your transaction signature", tx);
    } catch (e: any) {
      console.log(e);
    }
  });
});


function getParsedPayload(vaa: Buffer) {
  let amount = vaa.subarray(0, 32);
  let tokenAddress = vaa.subarray(32, 64);
  let tokenChain = vaa.subarray(64, 66);
  let toAddress = vaa.subarray(66, 98);
  let toChain = vaa.subarray(98, 100);
  let tokenDecimals = vaa.subarray(100, 101);

  return {
    amount: BigInt(`0x${amount.toString('hex')}`),
    tokenAddress: tokenAddress.toString('hex'),
    tokenChain: tokenChain.readUInt16BE(),
    toAddress: new PublicKey(toAddress),
    toChain: toChain.readUInt16BE(),
    tokenDecimals: tokenDecimals.readUInt8()
  }
}