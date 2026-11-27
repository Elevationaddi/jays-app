import { ApiProperty } from '@nestjs/swagger';

export class LivenessDto {
  @ApiProperty({ enum: ['ok'], example: 'ok' })
  status!: 'ok';

  @ApiProperty({ example: 'api' })
  service!: string;

  @ApiProperty({ example: '0.0.0' })
  version!: string;
}

export class ReadinessChecksDto {
  @ApiProperty({ enum: ['up', 'down'] })
  database!: 'up' | 'down';

  @ApiProperty({ enum: ['up', 'down'] })
  redis!: 'up' | 'down';
}

export class ReadinessDto {
  @ApiProperty({ enum: ['ready', 'not_ready'] })
  status!: 'ready' | 'not_ready';

  @ApiProperty({ type: ReadinessChecksDto })
  checks!: ReadinessChecksDto;
}

export class ErrorBodyDto {
  @ApiProperty({ example: 'NOT_FOUND' })
  code!: string;

  @ApiProperty()
  message!: string;

  @ApiProperty({
    required: false,
    type: Object,
    additionalProperties: { type: 'array', items: { type: 'string' } },
  })
  fieldErrors?: Record<string, string[]>;

  @ApiProperty({ example: '6f1c1d0e-2b7a-4b8e-9b0e-0a8f1f6c3d21' })
  requestId!: string;
}

export class ErrorEnvelopeDto {
  @ApiProperty({ type: ErrorBodyDto })
  error!: ErrorBodyDto;
}
