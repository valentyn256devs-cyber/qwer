import { Injectable } from '@nestjs/common';
import { Back4appService } from '../back4app/back4app.service';
import * as Parse from 'parse/node';
import { PerformerTable } from './model/performer-table';
import { PerformerStatus } from './model/performer.status';

/** Data required to create a new performer */
export interface CreatePerformerData {
  telegramId: string;
  username?: string;
  phoneNumber: string;
  latitude: number;
  longitude: number;
  firstName?: string;
  lastName?: string;
}

/** Mapped performer entity returned from Parse */
export interface PerformerEntity {
  id: string;
  telegramId: string;
  username?: string;
  phoneNumber?: string;
  firstName?: string;
  lastName?: string;
  city?: string;
  location?: { latitude: number; longitude: number };
  radiusKm?: number;
  status: PerformerStatus;
}

@Injectable()
export class PerformersService {
  private readonly className = PerformerTable.TableName;

  constructor(private readonly back4app: Back4appService) {}

  /** Find a performer by their Telegram user ID */
  async findByTelegramId(telegramId: string): Promise<PerformerEntity | null> {
    const query = new this.back4app.parse.Query(this.className);
    query.equalTo(PerformerTable.Fields.TelegramId, telegramId);
    const results = await query.find();
    if (results.length === 0) return null;
    return this.mapPerformer(results[0]);
  }

  /** Find a performer by their Parse objectId */
  async findById(id: string): Promise<PerformerEntity | null> {
    const query = new this.back4app.parse.Query(this.className);
    query.equalTo('objectId', id);
    const results = await query.find();
    if (results.length === 0) return null;
    return this.mapPerformer(results[0]);
  }

  /** Check whether a performer with the given Telegram ID already exists */
  async exists(telegramId: string): Promise<boolean> {
    const performer = await this.findByTelegramId(telegramId);
    return performer !== null;
  }

  /** Get all performers with an ACTIVE status (used for order notifications) */
  async findAllActive(): Promise<PerformerEntity[]> {
    const query = new this.back4app.parse.Query(this.className);
    query.equalTo(PerformerTable.Fields.status, PerformerStatus.ACTIVE);
    const results = await query.find();
    return results.map((p) => this.mapPerformer(p));
  }

  /** Get all performers regardless of status */
  async findAll(): Promise<PerformerEntity[]> {
    const query = new this.back4app.parse.Query(this.className);
    const results = await query.find();
    return results.map((p) => this.mapPerformer(p));
  }

  /**
   * Create a new performer.
   * New performers are created with status ACTIVE so they can immediately
   * receive order notifications and use the standard executor flow.
   */
  async create(data: CreatePerformerData): Promise<PerformerEntity> {
    const Performer = this.back4app.parse.Object.extend(this.className);
    const performer = new Performer();

    performer.set(PerformerTable.Fields.TelegramId, data.telegramId);
    if (data.username) {
      performer.set(PerformerTable.Fields.Username, data.username);
    }
    performer.set(PerformerTable.Fields.PhoneNumber, data.phoneNumber);
    if (data.firstName) {
      performer.set(PerformerTable.Fields.FirstName, data.firstName);
    }
    if (data.lastName) {
      performer.set(PerformerTable.Fields.LastName, data.lastName);
    }

    // Store location as a Parse GeoPoint
    const geoPoint = new this.back4app.parse.GeoPoint({
      latitude: data.latitude,
      longitude: data.longitude,
    });
    performer.set(PerformerTable.Fields.Location, geoPoint);

    performer.set(PerformerTable.Fields.status, PerformerStatus.ACTIVE);

    const saved = await performer.save();
    return this.mapPerformer(saved);
  }

  private mapPerformer(performer: Parse.Object): PerformerEntity {
    const location = performer.get(PerformerTable.Fields.Location) as
      | Parse.GeoPoint
      | undefined;

    return {
      id: performer.id!,
      telegramId: performer.get(PerformerTable.Fields.TelegramId) as string,
      username: performer.get(PerformerTable.Fields.Username) as string | undefined,
      phoneNumber: performer.get(PerformerTable.Fields.PhoneNumber) as string | undefined,
      firstName: performer.get(PerformerTable.Fields.FirstName) as string | undefined,
      lastName: performer.get(PerformerTable.Fields.LastName) as string | undefined,
      city: performer.get(PerformerTable.Fields.City) as string | undefined,
      location: location
        ? { latitude: location.latitude, longitude: location.longitude }
        : undefined,
      radiusKm: performer.get(PerformerTable.Fields.RadiusKm) as number | undefined,
      status: performer.get(PerformerTable.Fields.status) as PerformerStatus,
    };
  }
}