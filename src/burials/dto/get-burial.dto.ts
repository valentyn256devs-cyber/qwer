import {IsArray, IsNotEmpty, IsOptional, IsString} from "class-validator";
import {CreateBurialDto} from "./create-burial.dto";
import {OmitType} from "@nestjs/swagger";

export class GetBurialDto extends OmitType(CreateBurialDto, ['photos'] as const){
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true }) // 🔥 Перевіряє, що кожен елемент масиву — це рядок-URL
  photos?: string[];
}