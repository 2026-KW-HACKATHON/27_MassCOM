import { randomUUID } from 'node:crypto';

import { getAddress } from 'ethers';
import type { Pool, PoolClient } from 'pg';

import {
  WalletBindingError,
  type VerifiedWalletBinding,
  type WalletBindingStore,
} from '../wallet-binding.js';

type WalletBindingRow = {
  id: string;
  address_checksum: string;
  chain_id: number;
  binding_version: number;
  verified_at: Date;
  account_id?: string;
  status?: 'VERIFIED' | 'DISCONNECTED';
};

export class PostgresWalletBindingStore implements WalletBindingStore {
  constructor(
    private readonly pool: Pool,
    private readonly options: {
      now?: () => Date;
      nextId?: () => string;
    } = {},
  ) {}

  async recordVerified(input: {
    accountId: string;
    address: string;
    chainId: number;
    verifiedAt?: Date;
  }): Promise<VerifiedWalletBinding> {
    const address = getAddress(input.address);
    const normalized = address.toLowerCase();
    const now = input.verifiedAt ?? this.options.now?.() ?? new Date();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await lockWalletBindings(client);

      const activeForAccount = (
        await client.query<WalletBindingRow>(
          `SELECT id, address_checksum, chain_id, binding_version, verified_at
           FROM wallet_bindings
           WHERE account_id = $1 AND status = 'VERIFIED'
           FOR UPDATE`,
          [input.accountId],
        )
      ).rows[0];

      if (
        activeForAccount &&
        activeForAccount.address_checksum.toLowerCase() === normalized &&
        activeForAccount.chain_id === input.chainId
      ) {
        const refreshed = (
          await client.query<WalletBindingRow>(
            `UPDATE wallet_bindings
             SET verified_at = $1, updated_at = $1
             WHERE id = $2
             RETURNING id, address_checksum, chain_id, binding_version, verified_at`,
            [now, activeForAccount.id],
          )
        ).rows[0]!;
        await client.query('COMMIT');
        return mapBinding(refreshed);
      }

      const activeForAddress = (
        await client.query<{ account_id: string }>(
          `SELECT account_id
           FROM wallet_bindings
           WHERE address_normalized = $1 AND chain_id = $2 AND status = 'VERIFIED'
           FOR UPDATE`,
          [normalized, input.chainId],
        )
      ).rows[0];
      if (activeForAddress && activeForAddress.account_id !== input.accountId) {
        throw new WalletBindingError('WALLET_ADDRESS_IN_USE');
      }

      if (activeForAccount) {
        await client.query(
          `UPDATE wallet_bindings
           SET status = 'DISCONNECTED', disconnected_at = $1, updated_at = $1
           WHERE id = $2`,
          [now, activeForAccount.id],
        );
      }

      const version = (
        await client.query<{ next_version: number }>(
          `SELECT coalesce(max(binding_version), 0)::integer + 1 AS next_version
           FROM wallet_bindings
           WHERE account_id = $1`,
          [input.accountId],
        )
      ).rows[0]!.next_version;
      const inserted = (
        await client.query<WalletBindingRow>(
          `INSERT INTO wallet_bindings (
             id, account_id, address_checksum, address_normalized, chain_id,
             binding_version, status, verified_at, created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, 'VERIFIED', $7, $7, $7)
           RETURNING id, address_checksum, chain_id, binding_version, verified_at`,
          [
            this.options.nextId?.() ?? randomUUID(),
            input.accountId,
            address,
            normalized,
            input.chainId,
            version,
            now,
          ],
        )
      ).rows[0]!;
      await client.query('COMMIT');
      return mapBinding(inserted);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getActive(accountId: string): Promise<VerifiedWalletBinding | undefined> {
    const row = (
      await this.pool.query<WalletBindingRow>(
        `SELECT id, address_checksum, chain_id, binding_version, verified_at
         FROM wallet_bindings
         WHERE account_id = $1 AND status = 'VERIFIED'`,
        [accountId],
      )
    ).rows[0];
    return row ? mapBinding(row) : undefined;
  }

  async disconnect(input: {
    accountId: string;
    bindingId: string;
    bindingVersion: number;
  }): Promise<void> {
    const now = this.options.now?.() ?? new Date();
    const result = await this.pool.query(
      `UPDATE wallet_bindings
       SET status = 'DISCONNECTED', disconnected_at = $1, updated_at = $1
       WHERE id = $2
         AND account_id = $3
         AND binding_version = $4
         AND status = 'VERIFIED'`,
      [now, input.bindingId, input.accountId, input.bindingVersion],
    );
    if (result.rowCount === 1) return;

    const binding = await this.pool.query<{ binding_version: number }>(
      'SELECT binding_version FROM wallet_bindings WHERE id = $1 AND account_id = $2',
      [input.bindingId, input.accountId],
    );
    if (binding.rowCount !== 1) throw new WalletBindingError('WALLET_BINDING_NOT_FOUND');
    throw new WalletBindingError('WALLET_BINDING_CHANGED');
  }
}

async function lockWalletBindings(client: PoolClient): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('wallet-bindings', 0))");
}

function mapBinding(row: WalletBindingRow): VerifiedWalletBinding {
  return {
    bindingId: row.id,
    bindingVersion: row.binding_version,
    address: row.address_checksum,
    chainId: row.chain_id,
    verifiedAt: row.verified_at.toISOString(),
  };
}
