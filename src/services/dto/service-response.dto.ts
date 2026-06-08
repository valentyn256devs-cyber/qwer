import { Exclude, Expose } from 'class-transformer';
import { IsNotEmpty, IsNumber, IsString } from 'class-validator';
import * as Parse from 'parse/node';
import { ServiceTable } from '../models/service-table';

@Exclude()
export class ServiceResponseDto {
  @Expose()
  @IsString()
  @IsNotEmpty()
  id!: string;

  @Expose()
  @IsString()
  @IsNotEmpty()
  name!: string;

  @Expose()
  @IsString()
  description!: string;

  @Expose()
  @IsNumber()
  price!: number;

  @Expose()
  createdAt!: Date;

  static fromParse(service: Parse.Object): ServiceResponseDto {
    const dto = new ServiceResponseDto();
    dto.id = service.id;
    dto.name = service.get(ServiceTable.Fields.Name) as string;
    dto.description = service.get(ServiceTable.Fields.Description) as string;
    dto.price = service.get(ServiceTable.Fields.Price) as number;
    dto.createdAt = service.createdAt;
    return dto;
  }
}
