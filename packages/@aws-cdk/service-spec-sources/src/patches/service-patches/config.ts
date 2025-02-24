import { addDefinitions, forResource, registerServicePatches, replaceResourceProperty } from './core';
import { Reason } from '../../patching';

registerServicePatches(
  forResource('AWS::Config::RemediationConfiguration', (lens) => {
    const reason = Reason.sourceIssue('Unused property type in Spec, now missing in Schema');
    replaceResourceProperty(
      'Parameters',
      {
        type: 'object',
        additionalProperties: { $ref: '#/definitions/RemediationParameterValue' },
      },
      reason,
    )(lens);

    addDefinitions(
      {
        RemediationParameterValue: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ResourceValue: {
              $ref: '#/definitions/ResourceValue',
            },
            StaticValue: {
              $ref: '#/definitions/StaticValue',
            },
          },
        },
        ResourceValue: {
          type: 'object',
          additionalProperties: false,
          properties: {
            Value: {
              type: 'string',
            },
          },
        },
        StaticValue: {
          type: 'object',
          additionalProperties: false,
          properties: {
            Value: {
              type: 'array',
              items: {
                type: 'string',
              },
            },
          },
        },
      },
      reason,
    )(lens);
  }),
);
